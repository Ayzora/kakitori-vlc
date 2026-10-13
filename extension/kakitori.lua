--[[
Kakitori: adds Japanese subtitles, transcribed by ElevenLabs, as a track
inside an MP4, M4V or MOV video.

This extension only starts the work. "Transcribe this video" asks Start /
Cancel for the Video VLC is playing, writes its URI into job.json in the
state folder (VLC's user data folder plus "kakitori") and launches the core
program from its bin folder with no arguments, then returns at once. The core
reports back through status.json, which the Kakitori window shows; "Reload
video" then reopens the Video where it was, now with its Subtitle track.

Targets the VLC 3.0.x Lua extension API. Lua 5.1 compatible.

Nothing may run at the top level except definitions: when VLC scans the file
for its menu, the standard libraries (math, os, io, string...) aren't loaded.

Clicking Kakitori in VLC's Extensions menu activates the extension, which
opens the Kakitori window. Every path through it ends in finish(), which
deactivates the extension again, so the next click opens the window again.
VLC 3 on macOS never shows an extension's own submenu, so there is none.
--]]

local NOT_STARTED = "Kakitori didn't start. Your antivirus or macOS security may have blocked it. See the README."
local STATE_NAMES = {
  extracting = "Extracting the audio",
  transcribing = "Transcribing",
  muxing = "Adding the subtitle track",
  pending = "Ready to reload",
  done = "Done",
  error = "Failed",
}

local dialog = nil

-- VLC entry points --------------------------------------------------------

function descriptor()
  return {
    title = "Kakitori",
    version = "1.0.0",
    author = "Kakitori contributors",
    shortdesc = "Japanese subtitles inside your videos",
    description = "Transcribes the MP4, M4V or MOV you are watching with ElevenLabs "
      .. "and adds Japanese subtitles as a track inside the same file.",
    capabilities = {},
  }
end

function activate()
  show_home()
end

function deactivate()
  close_dialog()
end

-- The user closed a Kakitori window.
function close()
  vlc.deactivate()
end

-- Paths ---------------------------------------------------------------------

local function is_windows()
  return package.config:sub(1, 1) == "\\"
end

local function sep()
  return is_windows() and "\\" or "/"
end

local function state_file(name)
  return vlc.config.userdatadir() .. sep() .. "kakitori" .. sep() .. name
end

local function core_path()
  return state_file("bin") .. sep() .. (is_windows() and "kakitori.exe" or "kakitori")
end

local function basename(path)
  return (tostring(path or ""):match("([^/\\]+)$")) or tostring(path or "")
end

-- Single-quoted for sh: every character is literal.
local function sh_quote(s)
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

-- Files ---------------------------------------------------------------------

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local text = f:read("*a")
  f:close()
  return text
end

local function write_file(path, text)
  local f, err = io.open(path, "wb")
  if not f then return nil, err end
  f:write(text)
  f:close()
  return true
end

local function file_exists(path)
  local f = io.open(path, "rb")
  if f then f:close() end
  return f ~= nil
end

-- JSON for the flat objects in the state folder ------------------------------

local function json_string(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == "\\" then return "\\\\" end
    return string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function json_encode(object, keys)
  local parts = {}
  for _, key in ipairs(keys) do
    local value = object[key]
    local plain = type(value) == "number" or type(value) == "boolean"
    local encoded = plain and tostring(value) or json_string(tostring(value))
    parts[#parts + 1] = json_string(key) .. ":" .. encoded
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

local function utf8_char(code)
  if code < 0x80 then return string.char(code) end
  if code < 0x800 then
    return string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40)
  end
  if code < 0x10000 then
    return string.char(0xE0 + math.floor(code / 0x1000), 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
  end
  return string.char(
    0xF0 + math.floor(code / 0x40000),
    0x80 + math.floor(code / 0x1000) % 0x40,
    0x80 + math.floor(code / 0x40) % 0x40,
    0x80 + code % 0x40
  )
end

local ESCAPES = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

-- Reads a JSON object whose values are strings, numbers, booleans or null.
-- Returns nil for anything else.
local function json_decode(text)
  if not text then return nil end
  local pos = 1
  local function skip()
    pos = text:find("[^ \t\r\n]", pos) or #text + 1
  end
  local function read_string()
    local out = {}
    pos = pos + 1
    while pos <= #text do
      local c = text:sub(pos, pos)
      if c == '"' then
        pos = pos + 1
        return table.concat(out)
      elseif c == "\\" then
        local e = text:sub(pos + 1, pos + 1)
        if e == "u" then
          local code = tonumber(text:sub(pos + 2, pos + 5), 16)
          if not code then return nil end
          pos = pos + 6
          if code >= 0xD800 and code < 0xDC00 and text:sub(pos, pos + 1) == "\\u" then
            local low = tonumber(text:sub(pos + 2, pos + 5), 16)
            if low then
              code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
              pos = pos + 6
            end
          end
          out[#out + 1] = utf8_char(code)
        elseif ESCAPES[e] then
          out[#out + 1] = ESCAPES[e]
          pos = pos + 2
        else
          return nil
        end
      else
        out[#out + 1] = c
        pos = pos + 1
      end
    end
    return nil
  end
  local function read_value()
    skip()
    local c = text:sub(pos, pos)
    if c == '"' then return read_string() end
    for word, value in pairs({ ["true"] = true, ["false"] = false, ["null"] = "" }) do
      if text:sub(pos, pos + #word - 1) == word then
        pos = pos + #word
        return value
      end
    end
    local number = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
    if number and number ~= "" then
      pos = pos + #number
      return tonumber(number)
    end
    return nil
  end

  text = text:gsub("^\239\187\191", "")
  local object = {}
  skip()
  if text:sub(pos, pos) ~= "{" then return nil end
  pos = pos + 1
  skip()
  if text:sub(pos, pos) == "}" then return object end
  while true do
    skip()
    if text:sub(pos, pos) ~= '"' then return nil end
    local key = read_string()
    skip()
    if not key or text:sub(pos, pos) ~= ":" then return nil end
    pos = pos + 1
    local value = read_value()
    if value == nil then return nil end
    object[key] = value
    skip()
    local c = text:sub(pos, pos)
    pos = pos + 1
    if c == "}" then return object end
    if c ~= "," then return nil end
  end
end

local function read_json(path)
  return json_decode(read_file(path))
end

-- Dialogs -------------------------------------------------------------------

function close_dialog()
  if dialog then
    dialog:delete()
    dialog = nil
  end
end

-- Window size. VLC on Windows honours a minimum width and height per widget;
-- VLC on macOS only fits a window to its contents, and only widgets in a
-- single column count towards a column's width. So each window gets both:
-- minimum sizes, plus a blank row on top and a wide blank row at the bottom,
-- in column 1 alone on macOS.
local WINDOW_WIDTH = 520
local ROW_HEIGHT = 28
-- Characters per line of label text, which fits that width.
local LINE_LENGTH = 56

-- Opens a new window; its content goes in rows 2 and up.
local function open_window(title)
  close_dialog()
  dialog = vlc.dialog(title)
  dialog:add_label("\194\160", 1, 1, 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
  return dialog
end

-- Adds the wide blank row after the content, then shows the window.
local function show_window(row)
  -- No-break spaces, built here: the string library isn't loaded when VLC scans the file.
  dialog:add_label(string.rep("\194\160", 120), 1, row, is_windows() and 2 or 1, 1, WINDOW_WIDTH, ROW_HEIGHT)
  dialog:show()
end

-- Ends what the click started: closes the window and deactivates.
function finish()
  close_dialog()
  vlc.deactivate()
end

-- Label text ------------------------------------------------------------------

-- The code points of UTF-8 text.
local function code_points(s)
  local points = {}
  for char in s:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
    local value = char:byte(1)
    if #char == 2 then value = value % 0x20 end
    if #char == 3 then value = value % 0x10 end
    if #char == 4 then value = value % 0x08 end
    for i = 2, #char do value = value * 0x40 + char:byte(i) % 0x40 end
    points[#points + 1] = value
  end
  return points
end

-- Splits text at spaces into lines of at most LINE_LENGTH characters. A word
-- longer than that, such as a long file name, loses its middle to "…".
local function wrap(text)
  local lines, line = {}, {}
  for word in text:gmatch("%S+") do
    local points = code_points(word)
    if #points > LINE_LENGTH then
      local head = math.floor((LINE_LENGTH - 1) / 2)
      local short = {}
      for i = 1, head do short[i] = points[i] end
      short[head + 1] = 0x2026
      for i = #points - (LINE_LENGTH - head - 2), #points do short[#short + 1] = points[i] end
      points = short
    end
    if #line > 0 and #line + 1 + #points > LINE_LENGTH then
      lines[#lines + 1] = line
      line = {}
    end
    if #line > 0 then line[#line + 1] = 32 end
    for _, point in ipairs(points) do line[#line + 1] = point end
  end
  if #line > 0 then lines[#lines + 1] = line end
  return lines
end

-- Labels are rich text. Everything but plain ASCII becomes a character
-- reference: VLC on macOS reads label text as Latin-1, which has no Japanese.
local ESCAPES = { [38] = "&amp;", [60] = "&lt;", [62] = "&gt;" }

local function to_html(points)
  local out = {}
  for i, point in ipairs(points) do
    out[i] = ESCAPES[point] or (point < 128 and string.char(point)) or ("&#" .. point .. ";")
  end
  return table.concat(out)
end

-- Rich text for a label showing `lines`, and how many lines it takes up.
-- The <div> makes VLC on Windows treat it as rich text too.
local function label_text(lines)
  local out = {}
  for _, line in ipairs(lines) do
    for _, wrapped in ipairs(wrap(tostring(line))) do out[#out + 1] = to_html(wrapped) end
  end
  return "<div>" .. table.concat(out, "<br>") .. "</div>", #out
end

-- Adds a label across the window at `row`.
local function add_text(lines, row)
  local text, count = label_text(lines)
  return dialog:add_label(text, 1, row, 2, 1, WINDOW_WIDTH, ROW_HEIGHT * math.max(count, 1))
end

local function show_message(lines)
  open_window("Kakitori")
  add_text(lines, 2)
  dialog:add_button("OK", finish, 2, 3, 1, 1)
  show_window(4)
end

-- API key -------------------------------------------------------------------

local function load_key()
  local config = read_json(state_file("config.json"))
  if config and type(config.apiKey) == "string" and config.apiKey:match("%S") then
    return config.apiKey
  end
  return nil
end

local function save_key(key)
  local path = state_file("config.json")
  local ok, err = write_file(path, json_encode({ apiKey = key }, { "apiKey" }))
  if not ok then return nil, err end
  if not is_windows() then
    os.execute("chmod 600 " .. sh_quote(path))
  end
  return true
end

function show_key_dialog(after_save)
  open_window("Kakitori – Setup")
  add_text({ "Paste your ElevenLabs API key. It is saved on this computer in plain text." }, 2)
  local field = dialog:add_password("", 1, 3, 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
  local problem = dialog:add_label("", 1, 4, 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
  dialog:add_button("Save", function()
    local key = (field:get_text() or ""):match("^%s*(.-)%s*$")
    if key == "" then
      problem:set_text("Enter a key first.")
      return
    end
    local ok, err = save_key(key)
    if not ok then
      problem:set_text((label_text({ "Couldn't save the key: " .. tostring(err) })))
      return
    end
    after_save()
  end, 1, 5, 1, 1)
  dialog:add_button("Cancel", finish, 2, 5, 1, 1)
  show_window(6)
end


-- Starting the core -----------------------------------------------------------

-- Where the last request in job.json stands. The core deletes job.json as
-- soon as it starts, so one still there after 60 seconds was never picked up.
-- One the extension can't read is treated as never picked up too.
local function request_state()
  local path = state_file("job.json")
  if not file_exists(path) then return "none" end
  local request = read_json(path)
  local created = request and tonumber(request.createdAt)
  if created == nil or os.time() - created > 60 then return "leftover" end
  return "starting"
end

local STILL_STARTING = "Kakitori is still starting the last transcription. Try again in a moment."

-- Why a new request can't be made now, or nil if it can.
local function cannot_start()
  local waiting = request_state()
  if waiting == "leftover" then
    os.remove(state_file("job.json"))
    return NOT_STARTED
  elseif waiting == "starting" then
    -- Never overwrite a request the core hasn't picked up yet.
    return STILL_STARTING
  end
  if not file_exists(core_path()) then
    return "Kakitori isn't fully installed. Run the install command again."
  end
  return nil
end

local function launch_core()
  local bin = core_path()
  if is_windows() then
    os.execute('start "" /b "' .. bin .. '"')
  else
    os.execute(sh_quote(bin) .. " >/dev/null 2>&1 &")
  end
end

-- Asks the core to transcribe the Video at `uri`, replacing its Subtitle
-- track when `replace`. Returns the request's id, or nil and why not. The
-- URI goes through job.json, never a command line.
local function start_core(uri, replace)
  local problem = cannot_start()
  if problem then return nil, problem end
  math.randomseed(os.time())
  local request = {
    id = tostring(os.time()) .. "-" .. tostring(math.random(100000, 999999)),
    createdAt = os.time(),
    videoUri = uri,
    replace = replace == true,
  }
  local keys = { "id", "createdAt", "videoUri", "replace" }
  local ok, err = write_file(state_file("job.json"), json_encode(request, keys))
  if not ok then return nil, "Couldn't start Kakitori: " .. tostring(err) .. ". Run the install command again." end
  launch_core()
  return request.id
end

-- The Video VLC is playing ------------------------------------------------------

-- The file name in a file:// URI.
local function file_name(uri)
  return basename(vlc.strings.decode_uri(uri))
end

-- 0:03, 12:05, 1:02:05
local function format_length(seconds)
  local total = math.floor((tonumber(seconds) or 0) + 0.5)
  local h, m, s = math.floor(total / 3600), math.floor(total / 60) % 60, total % 60
  if h > 0 then return string.format("%d:%02d:%02d", h, m, s) end
  return string.format("%d:%02d", m, s)
end

-- The URI and length of the Video VLC is playing, or nil and why it can't be transcribed.
local function playing_video()
  local item = vlc.input.item()
  if not item then return nil, "Open a video in VLC first, then click Transcribe this video." end
  local uri = item:uri() or ""
  if not uri:match("^file://") then return nil, "Kakitori can only transcribe a video file on this computer." end
  local ext = (uri:match("%.(%w+)$") or ""):lower()
  if ext ~= "mp4" and ext ~= "m4v" and ext ~= "mov" then
    return nil, "Subtitles can't be added to this file type. Kakitori works with MP4, M4V and MOV."
  end
  return { uri = uri, duration = item:duration() }
end

-- VLC gives extensions no way to sleep, so this spins. Only the Windows
-- Pending copy path in reload_video() waits, for a few seconds at most.
local function spin(seconds)
  local start = os.clock()
  while os.clock() - start < seconds do end
end

-- Whether the last Transcription is of the Video VLC is playing.
local function is_playing(status)
  local item = vlc.input.item()
  return status ~= nil and item ~= nil and type(status.videoUri) == "string" and item:uri() == status.videoUri
end

-- Whether the Video as VLC opened it has a Japanese subtitle track. VLC
-- names each track by its language, e.g. "Track 1 - [Japanese]".
local function has_japanese_subtitles()
  local input = vlc.object.input()
  if not input then return false end
  local _, names = vlc.var.get_list(input, "spu-es")
  for _, name in ipairs(names or {}) do
    if tostring(name):match("Japanese") then return true end
  end
  return false
end

-- Whether the Video playing has Japanese subtitles, counting a Subtitle
-- track added since VLC opened it.
local function is_subtitled(status)
  return has_japanese_subtitles() or (is_playing(status) and status.state == "done")
end

-- Transcribing ----------------------------------------------------------------

function transcribe_video()
  if not load_key() then
    show_key_dialog(transcribe_video)
    return
  end
  local video, problem = playing_video()
  if not video then
    show_message({ problem })
    return
  end
  local again = is_subtitled(read_json(state_file("status.json")))
  local name = file_name(video.uri)
  local length = " (" .. format_length(video.duration) .. ")"
  open_window("Kakitori")
  -- Nothing is uploaded or billed before the user has seen the name and length.
  if again then
    add_text({
      "Transcribe " .. name .. length .. " again?",
      "Its Japanese subtitles will be replaced. The audio is uploaded and billed again.",
    }, 2)
  else
    add_text({ "Transcribe " .. name .. length .. "?" }, 2)
  end
  dialog:add_button("Start", function()
    local id, err = start_core(video.uri, again)
    if not id then
      show_message({ err })
      return
    end
    show_message({
      "Transcribing " .. name .. " in the background. Keep watching.",
      "You'll get a notification when it's done. Then open Kakitori again and click Reload video.",
    })
  end, 1, 3, 1, 1)
  dialog:add_button("Cancel", finish, 2, 3, 1, 1)
  show_window(4)
end

-- Reloading -------------------------------------------------------------------

local RUNNING = { extracting = true, transcribing = true, muxing = true }

-- The id of the newest playlist entry for `uri`.
local function newest_entry(uri)
  local newest
  local function visit(node)
    if node.path == uri and (not newest or node.id > newest) then newest = node.id end
    for _, child in ipairs(node.children or {}) do visit(child) end
  end
  visit(vlc.playlist.get("normal"))
  return newest
end

-- Opens the Video afresh at `time` (VLC's microseconds) with the Subtitle
-- track showing, in place of playlist entry `old` when given.
local function reopen(uri, old, time)
  local options = { ":sub-language=jpn" }
  if time and time > 0 then options[#options + 1] = ":start-time=" .. string.format("%.3f", time / 1000000) end
  vlc.playlist.enqueue({ { path = uri, options = options } })
  local new = newest_entry(uri)
  if old and new and new ~= old then
    vlc.playlist.move(new, old)
    vlc.playlist.delete(old)
  end
  if new then vlc.playlist.gotoitem(new) end
end

-- Waits up to 20 seconds for the Transcription `id` to finish; returns its status.
local function wait_for_core(id)
  for _ = 1, 80 do
    spin(0.25)
    local status = read_json(state_file("status.json"))
    if status and status.id == id and not RUNNING[status.state] then return status end
  end
  return nil
end

-- Reopens the Video, now with its Subtitle track, where it was. Opening the
-- file again is the only way VLC sees the new track, and VLC on macOS never
-- tells an extension when playback starts, so the time and the track go in
-- as options of a new playlist entry. A Pending copy (Windows only: VLC was
-- playing the Video) is added first, once playback has stopped.
function reload_video()
  local status = read_json(state_file("status.json"))
  if not status or type(status.videoUri) ~= "string" then
    show_message({ "Nothing to reload yet." })
    return
  end
  local uri = status.videoUri
  local item = vlc.input.item()
  local id, time
  if item and item:uri() == uri then
    id = vlc.playlist.current()
    local input = vlc.object.input()
    if input then time = vlc.var.get(input, "time") end
  end

  if status.state == "pending" then
    vlc.playlist.stop()
    spin(1)
    -- replace: the Pending copy may be replacing an older Subtitle track.
    local request_id, problem = start_core(uri, true)
    if not request_id then
      show_message({ problem })
      return
    end
    status = wait_for_core(request_id)
    if not status or status.state ~= "done" then
      show_message({ status and status.message or "Kakitori is still adding the subtitles. Click Reload video again in a moment." })
      return
    end
  end

  reopen(uri, id, time)
  finish()
end

-- The Kakitori window ------------------------------------------------------------

-- What the window says about the Video playing, as lines, or nil. Only
-- the last Transcription is known, so other Videos rely on VLC's tracks.
local function status_lines(status)
  if request_state() == "leftover" then return { NOT_STARTED } end
  if is_playing(status) then
    -- e.g. "Japanese subtitles added to …", next to Reload video.
    if status.state == "done" then return { status.message } end
    local detail = status.message
    if not detail or detail == "" then detail = basename(status.inputPath) end
    return { STATE_NAMES[status.state] or tostring(status.state), detail }
  end
  if has_japanese_subtitles() then return { "This video already has Japanese subtitles." } end
  return nil
end

function show_home()
  open_window("Kakitori")
  local row = 2
  local status = read_json(state_file("status.json"))
  local lines = status_lines(status)
  if lines then
    add_text(lines, row)
    row = row + 1
  end
  local label = is_subtitled(status) and "Transcribe again" or "Transcribe this video"
  dialog:add_button(label, transcribe_video, 1, row, 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
  row = row + 1
  -- Only for the Video playing: Reload video reopens the Video it transcribed.
  if is_playing(status) and (status.state == "done" or status.state == "pending") then
    dialog:add_button("Reload video", reload_video, 1, row, 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
    row = row + 1
  end
  dialog:add_button("Change API key", function()
    show_key_dialog(function() show_message({ "API key saved." }) end)
  end, 1, row, 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
  show_window(row + 1)
end
