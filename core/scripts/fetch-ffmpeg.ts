import { $ } from "bun";
import { mkdir, mkdtemp, readdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Archive = { url: string; sha256: string };

const MAC = "https://ffmpeg.martin-riedl.de/download/macos";

const TARGETS: Record<string, Archive[]> = {
  "darwin-arm64": [
    {
      url: `${MAC}/arm64/1789931890_9.0.2/ffmpeg.zip`,
      sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
    },
    {
      url: `${MAC}/arm64/1789931890_9.0.2/ffprobe.zip`,
      sha256: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
    },
  ],
  "darwin-x64": [
    {
      url: `${MAC}/amd64/1789931006_9.0.2/ffmpeg.zip`,
      sha256: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4",
    },
    {
      url: `${MAC}/amd64/1789931006_9.0.2/ffprobe.zip`,
      sha256: "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd",
    },
  ],
  "windows-x64": [
    {
      url: "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip",
      sha256: "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba",
    },
  ],
};

function currentTarget() {
  if (process.platform === "win32") return "windows-x64";
  return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}

const target = process.argv[2] ?? currentTarget();
const outDir = resolve(process.argv[3] ?? join(import.meta.dir, "..", "vendor", "ffmpeg"));
const archives = TARGETS[target];
if (!archives) {
  console.error(`Unknown target ${target}. Use one of: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

const work = await mkdtemp(join(tmpdir(), "kakitori-ffmpeg-"));
try {
  await mkdir(outDir, { recursive: true });
  for (const [i, archive] of archives.entries()) {
    const response = await fetch(archive.url);
    if (!response.ok) throw new Error(`${archive.url} answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (actual !== archive.sha256) {
      throw new Error(`Checksum mismatch for ${archive.url}: got ${actual}`);
    }
    const zip = join(work, `${i}.zip`);
    await Bun.write(zip, bytes);
    await $`${tar} -xf ${zip} -C ${work}`.quiet();
  }
  const ext = target.startsWith("windows") ? ".exe" : "";
  for (const tool of ["ffmpeg", "ffprobe"]) {
    const found = await findFile(work, tool + ext);
    if (!found) throw new Error(`${tool}${ext} not found in the downloaded archive`);
    const dest = join(outDir, tool + ext);
    await Bun.write(dest, Bun.file(found));
    if (!ext) await chmod(dest, 0o755);
  }
  console.log(`ffmpeg and ffprobe for ${target} are in ${outDir}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
