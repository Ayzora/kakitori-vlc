--[[
Kakitori: adds Japanese subtitles, transcribed by ElevenLabs, as a track
inside a queued MP4, M4V or MOV video.

This extension only starts the work. It writes job.json into the state folder
(VLC's user data folder plus "kakitori") and launches the core program from
its bin folder with no arguments, then returns at once. The core reports back
with a system popup and status.json. See docs/adr/0002-job-file-handoff.md.

Targets the VLC 3.0.x Lua extension API. Lua 5.1 compatible.
--]]

local MENU = { "Transcribe", "Change API key", "Show last status" }
local SUPPORTED = { mp4 = true, m4v = true, mov = true }
local NOT_STARTED = "Kakitori didn't start. Your antivirus or macOS security may have blocked it. See the README."
local STATE_NAMES = {
  extracting = "Extracting the audio",
  transcribing = "Transcribing",
  muxing = "Adding the subtitle track",
  ["waiting-for-unlock"] = "Waiting for the video to be closed",
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
    shortdesc = "Japanese subtitles for a queued video",
    description = "Transcribes the most recently queued MP4, M4V or MOV with ElevenLabs "
      .. "and adds Japanese subtitles as a track inside the same file.",
    capabilities = { "menu" },
  }
end

-- VLC calls this before trigger_menu; the menu items do the work.
function activate()
end

function deactivate()
  close_dialog()
end

function close()
  close_dialog()
end

function menu()
  return MENU
end

function trigger_menu(id)
  if id == 1 then
    transcribe()
  elseif id == 2 then
    show_key_dialog(nil)
  elseif id == 3 then
    show_status()
  end
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
    local encoded = type(value) == "number" and tostring(value) or json_string(tostring(value))
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

-- Labels are rich text, so names are escaped and lines joined with <br>.
local function html(s)
  return (tostring(s):gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

local function show_message(lines)
  close_dialog()
  dialog = vlc.dialog("Kakitori")
  local escaped = {}
  for i, line in ipairs(lines) do escaped[i] = html(line) end
  dialog:add_label(table.concat(escaped, "<br>"), 1, 1, 2, 1)
  dialog:add_button("OK", close_dialog, 2, 2, 1, 1)
  dialog:show()
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
  close_dialog()
  dialog = vlc.dialog("Kakitori – Setup")
  dialog:add_label("Paste your ElevenLabs API key. It is saved on this computer in plain text.", 1, 1, 2, 1)
  local field = dialog:add_password("", 1, 2, 2, 1)
  local problem = dialog:add_label("", 1, 3, 2, 1)
  dialog:add_button("Save", function()
    local key = (field:get_text() or ""):match("^%s*(.-)%s*$")
    if key == "" then
      problem:set_text("Enter a key first.")
      return
    end
    local ok, err = save_key(key)
    if not ok then
      problem:set_text(html("Couldn't save the key: " .. tostring(err)))
      return
    end
    close_dialog()
    if after_save then after_save() end
  end, 1, 4, 1, 1)
  dialog:add_button("Cancel", close_dialog, 2, 4, 1, 1)
  dialog:show()
end

-- Choosing the Video ----------------------------------------------------------

-- Lua can't read the item highlighted in the playlist, so the target is the
-- most recently added local MP4, M4V or MOV. Playlist ids grow as items are
-- added, so the highest id is the newest.
local function find_target()
  local best = nil
  local function visit(node)
    if type(node) ~= "table" then return end
    if node.children then
      for _, child in ipairs(node.children) do visit(child) end
      return
    end
    local uri = node.path
    if type(uri) == "string" and uri:sub(1, 7) == "file://" then
      local ext = uri:match("%.(%w+)$")
      if ext and SUPPORTED[ext:lower()] and (best == nil or node.id > best.id) then
        best = node
      end
    end
  end
  visit(vlc.playlist.get("playlist", false))
  return best
end

local function uri_to_path(uri)
  if vlc.strings.make_path then
    local path = vlc.strings.make_path(uri)
    if path then return path end
  end
  local path = vlc.strings.decode_uri(uri):gsub("^file://", "")
  if is_windows() then
    path = path:gsub("^/(%a:)", "%1"):gsub("/", "\\")
  end
  return path
end

local function format_duration(seconds)
  seconds = tonumber(seconds)
  if not seconds or seconds <= 0 then return "length unknown" end
  seconds = math.floor(seconds + 0.5)
  local h, m, s = math.floor(seconds / 3600), math.floor(seconds / 60) % 60, seconds % 60
  if h > 0 then return string.format("%d:%02d:%02d", h, m, s) end
  return string.format("%d:%02d", m, s)
end

-- Starting the core -----------------------------------------------------------

-- A job.json the core never picked up: it deletes the file as soon as it starts.
local function leftover_job()
  local path = state_file("job.json")
  if not file_exists(path) then return false end
  local job = read_json(path)
  local created = job and tonumber(job.createdAt)
  return created == nil or os.time() - created > 60
end

local function launch_core()
  local bin = core_path()
  if is_windows() then
    os.execute('start "" /b "' .. bin .. '"')
  else
    os.execute(sh_quote(bin) .. " >/dev/null 2>&1 &")
  end
end

local function start(path)
  local job = {
    id = tostring(os.time()) .. "-" .. tostring(math.random(100000, 999999)),
    inputPath = path,
    createdAt = os.time(),
  }
  local ok, err = write_file(state_file("job.json"), json_encode(job, { "id", "inputPath", "createdAt" }))
  if not ok then
    show_message({ "Couldn't start Kakitori: " .. tostring(err), "Run the install command again." })
    return
  end
  launch_core()
  close_dialog()
  pcall(vlc.osd.message, "Transcribing…")
end

function transcribe()
  if not load_key() then
    show_key_dialog(transcribe)
    return
  end
  if leftover_job() then
    os.remove(state_file("job.json"))
    show_message({ NOT_STARTED })
    return
  end
  if not file_exists(core_path()) then
    show_message({ "Kakitori isn't fully installed. Run the install command again." })
    return
  end
  local item = find_target()
  if not item then
    show_message({ "Add an MP4, M4V or MOV video to the playlist first." })
    return
  end

  local path = uri_to_path(item.path)
  local name = basename(path)
  close_dialog()
  dialog = vlc.dialog("Kakitori")
  dialog:add_label(html("Transcribe " .. name .. " (" .. format_duration(item.duration) .. ")?"), 1, 1, 2, 1)
  dialog:add_button("Start", function() start(path) end, 1, 2, 1, 1)
  dialog:add_button("Cancel", close_dialog, 2, 2, 1, 1)
  dialog:show()
end

-- Status ------------------------------------------------------------------------

function show_status()
  if leftover_job() then
    show_message({ NOT_STARTED })
    return
  end
  local status = read_json(state_file("status.json"))
  if not status then
    show_message({ "Nothing has been transcribed yet." })
    return
  end
  local lines = {
    "State: " .. (STATE_NAMES[status.state] or tostring(status.state)),
    "File: " .. basename(status.inputPath),
  }
  if status.message and status.message ~= "" then lines[#lines + 1] = status.message end
  lines[#lines + 1] = "Updated: " .. tostring(status.updatedAt)
  show_message(lines)
end

math.randomseed(os.time())
