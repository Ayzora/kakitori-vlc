local NOT_STARTED = "Kakitori didn't start. Your antivirus or macOS security may have blocked it. On a Mac, click Open Anyway in System Settings > Privacy & Security. On Windows, allow kakitori.exe in SmartScreen or your antivirus."
local STATE_NAMES = {
  extracting = "Extracting the audio",
  transcribing = "Transcribing",
  muxing = "Adding the subtitle track",
  pending = "Ready to reload",
  done = "Done",
  error = "Failed",
}

local dialog = nil

function descriptor()
  return {
    title = "Kakitori",
    version = "1.3.0",
    author = "Kakitori contributors",
    shortdesc = "Japanese subtitles inside your videos",
    description = "Transcribes the MP4, M4V, MOV or MKV you are watching with ElevenLabs "
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

function close()
  vlc.deactivate()
end

local function is_windows()
  return package.config:sub(1, 1) == "\\"
end

local function is_mac()
  return vlc.config.userdatadir():find("/Library/Application Support/", 1, true) ~= nil
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

local function sh_quote(s)
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

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

function close_dialog()
  if dialog then
    dialog:delete()
    dialog = nil
  end
end

local WINDOW_WIDTH = 520
local ROW_HEIGHT = 28
local LINE_LENGTH = 56

local function open_window(title)
  close_dialog()
  dialog = vlc.dialog(title)
  dialog:add_label("\194\160", 1, 1, 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
  return dialog
end

local function show_window(row)
  dialog:add_label(string.rep("\194\160", 120), 1, row, is_mac() and 1 or 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
  dialog:show()
end

function finish()
  close_dialog()
  vlc.deactivate()
end

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

local ESCAPES = { [38] = "&amp;", [60] = "&lt;", [62] = "&gt;" }

local function to_html(points)
  local out = {}
  for i, point in ipairs(points) do
    out[i] = ESCAPES[point] or (point < 128 and string.char(point)) or ("&#" .. point .. ";")
  end
  return table.concat(out)
end

local function label_text(lines)
  local out = {}
  for _, line in ipairs(lines) do
    for _, wrapped in ipairs(wrap(tostring(line))) do out[#out + 1] = to_html(wrapped) end
  end
  return "<div>" .. table.concat(out, "<br>") .. "</div>", #out
end

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

local function request_state()
  local path = state_file("job.json")
  if not file_exists(path) then return "none" end
  local request = read_json(path)
  local created = request and tonumber(request.createdAt)
  if created == nil or os.time() - created > 60 then return "leftover" end
  return "starting"
end

local STILL_STARTING = "Kakitori is still starting the last transcription. Try again in a moment."

local function cannot_start()
  local waiting = request_state()
  if waiting == "leftover" then
    os.remove(state_file("job.json"))
    return NOT_STARTED
  elseif waiting == "starting" then
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

local function file_name(uri)
  return basename(vlc.strings.decode_uri(uri))
end

local function format_length(seconds)
  local total = math.floor((tonumber(seconds) or 0) + 0.5)
  local h, m, s = math.floor(total / 3600), math.floor(total / 60) % 60, total % 60
  if h > 0 then return string.format("%d:%02d:%02d", h, m, s) end
  return string.format("%d:%02d", m, s)
end

local function playing_video()
  local item = vlc.input.item()
  if not item then return nil, "Open a video in VLC first, then click Transcribe this video." end
  local uri = item:uri() or ""
  if not uri:match("^file://") then return nil, "Kakitori can only transcribe a video file on this computer." end
  local ext = (uri:match("%.(%w+)$") or ""):lower()
  if ext ~= "mp4" and ext ~= "m4v" and ext ~= "mov" and ext ~= "mkv" then
    return nil, "Subtitles can't be added to this file type. Kakitori works with MP4, M4V, MOV and MKV."
  end
  return { uri = uri, duration = item:duration() }
end

local function spin(seconds)
  local start = os.clock()
  while os.clock() - start < seconds do end
end

local function is_playing(status)
  local item = vlc.input.item()
  return status ~= nil and item ~= nil and type(status.videoUri) == "string" and item:uri() == status.videoUri
end

local function has_japanese_subtitles()
  local input = vlc.object.input()
  if not input then return false end
  local _, names = vlc.var.get_list(input, "spu-es")
  for _, name in ipairs(names or {}) do
    if tostring(name):match("Japanese") then return true end
  end
  return false
end

local function is_subtitled(status)
  return has_japanese_subtitles() or (is_playing(status) and status.state == "done")
end

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

local RUNNING = { extracting = true, transcribing = true, muxing = true }

local function newest_entry(uri)
  local newest
  local function visit(node)
    if node.path == uri and (not newest or node.id > newest) then newest = node.id end
    for _, child in ipairs(node.children or {}) do visit(child) end
  end
  visit(vlc.playlist.get("normal"))
  return newest
end

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

local function wait_for_core(id)
  for _ = 1, 80 do
    spin(0.25)
    local status = read_json(state_file("status.json"))
    if status and status.id == id and not RUNNING[status.state] then return status end
  end
  return nil
end

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

local function status_lines(status)
  if request_state() == "leftover" then return { NOT_STARTED } end
  if is_playing(status) then
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
  if is_playing(status) and (status.state == "done" or status.state == "pending") then
    dialog:add_button("Reload video", reload_video, 1, row, 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
    row = row + 1
  end
  dialog:add_button("Change API key", function()
    show_key_dialog(function() show_message({ "API key saved." }) end)
  end, 1, row, 2, 1, WINDOW_WIDTH, ROW_HEIGHT)
  show_window(row + 1)
end
