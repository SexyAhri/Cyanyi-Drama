import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { TextDecoder } from "node:util";

import {
  extractEpisodeExcerpt,
  MAX_MANUSCRIPT_CHARS,
  persistEpisodeSplits,
  saveManuscript,
  type EpisodeSplitDraft,
} from "@/lib/episodes/split";
import { extractManuscriptMetadata } from "@/lib/episodes/manuscript-metadata";
import {
  parseNovelStructure,
  parseVolumeSelection,
  selectNovelVolumes,
} from "@/lib/episodes/novel-volumes";
import { prisma } from "@/lib/server/prisma";

type CliOptions = {
  source?: string;
  project?: string;
  volumes?: string;
  start?: number;
  dryRun: boolean;
  scanOnly: boolean;
  yes: boolean;
  help: boolean;
};

type ProjectChoice = Awaited<ReturnType<typeof listProjects>>[number];

let prompt: ReturnType<typeof createInterface> | null = null;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const filePath = await selectNovelFile(options.source);
  const decoded = decodeNovel(await readFile(filePath));
  const metadata = extractManuscriptMetadata(decoded.text, basename(filePath));
  const structure = parseNovelStructure(decoded.text);
  if (!structure.totalChapters)
    throw new Error("没有识别到“第X章 / 第X回 / 第X节”格式的章节标题");

  console.log(`\n小说：${metadata.title}`);
  console.log(`文件：${filePath}`);
  console.log(`编码：${decoded.encoding}`);
  console.log(
    `检测：${structure.volumes.length} 卷，${structure.totalChapters} 章，${decoded.text.length.toLocaleString()} 字符\n`,
  );
  printVolumes(structure.volumes);
  if (options.scanOnly) return;

  const selection =
    options.volumes ??
    (await ask("\n选择要导入的卷（如 1,3 或 1-2，全部输入 all）："));
  const selectedIndices = parseVolumeSelection(
    selection,
    structure.volumes.length,
  );
  const selectedSource = selectNovelVolumes(
    decoded.text,
    structure.volumes,
    selectedIndices,
  );
  if (selectedSource.length > MAX_MANUSCRIPT_CHARS)
    throw new Error(
      `所选原稿超过 ${MAX_MANUSCRIPT_CHARS.toLocaleString()} 字符，请减少卷数`,
    );
  const selectedStructure = parseNovelStructure(selectedSource);
  const chapters = selectedStructure.volumes.flatMap((volume) => volume.chapters);
  if (!chapters.length) throw new Error("所选卷中没有识别到章节");

  const project = await selectProject(options.project);
  const latestEpisode = await prisma.episode.findFirst({
    where: { projectId: project.id },
    orderBy: { episodeNumber: "desc" },
    select: { episodeNumber: true },
  });
  const startEpisode = options.start ?? (latestEpisode?.episodeNumber ?? 0) + 1;
  if (!Number.isInteger(startEpisode) || startEpisode <= 0)
    throw new Error("起始集数必须是正整数");
  const endEpisode = startEpisode + chapters.length - 1;

  const sourceHash = createHash("sha256").update(selectedSource).digest("hex");
  const existingManuscript = await prisma.manuscript.findUnique({
    where: {
      projectId_sourceHash: { projectId: project.id, sourceHash },
    },
    select: { id: true, title: true },
  });
  if (existingManuscript) {
    const importedSources = await prisma.episodeSourceVersion.count({
      where: { manuscriptId: existingManuscript.id, kind: "original" },
    });
    if (importedSources) {
      console.log(
        `\n所选内容已通过原稿“${existingManuscript.title}”导入，共 ${importedSources} 个剧集版本，本次未重复创建。`,
      );
      return;
    }
  }

  const collisions = await prisma.episode.findMany({
    where: {
      projectId: project.id,
      episodeNumber: { gte: startEpisode, lte: endEpisode },
    },
    orderBy: { episodeNumber: "asc" },
    select: { episodeNumber: true, name: true },
    take: 5,
  });
  if (collisions.length) {
    const examples = collisions
      .map((episode) => `第 ${episode.episodeNumber} 集“${episode.name}”`)
      .join("、");
    throw new Error(
      `目标集数 ${startEpisode}-${endEpisode} 已存在剧集（${examples}）。请用 --start 指定空闲起始集数。`,
    );
  }

  const selectedVolumes = selectedIndices.map(
    (index) => structure.volumes[index - 1],
  );
  console.log("\n导入计划：");
  console.log(`  项目：${project.name}（${project.owner}）`);
  console.log(`  卷：${selectedVolumes.map((volume) => volume.title).join("、")}`);
  console.log(`  章节：${chapters.length} 章`);
  console.log(`  剧集：第 ${startEpisode} 集至第 ${endEpisode} 集`);
  console.log(`  原稿：${selectedSource.length.toLocaleString()} 字符`);

  if (options.dryRun) {
    console.log("\n预演完成，数据库未修改。");
    return;
  }

  if (!options.yes) {
    const confirmed = (await ask("\n确认创建这些剧集？[y/N]："))
      .trim()
      .toLowerCase();
    if (!["y", "yes", "是"].includes(confirmed)) {
      console.log("已取消，数据库未修改。");
      return;
    }
  }

  const allVolumesSelected =
    selectedIndices.length === structure.volumes.length;
  const manuscriptTitle = allVolumesSelected
    ? metadata.title
    : `${metadata.title}（${selectedVolumes.map((volume) => volume.title).join("、")}）`;
  console.log("\n正在保存原稿并批量创建剧集...");
  const manuscript = await saveManuscript({
    userId: project.userId,
    projectId: project.id,
    content: selectedSource,
    title: manuscriptTitle,
    author: metadata.author,
    synopsis: metadata.synopsis,
    sourceFileName: basename(filePath),
  });
  const episodes: EpisodeSplitDraft[] = chapters.map((chapter, index) => {
    const content = selectedSource.slice(chapter.startIndex, chapter.endIndex);
    return {
      number: startEpisode + index,
      title: chapter.heading.slice(0, 160),
      summary: extractEpisodeExcerpt(content),
      content: "",
      wordCount: 0,
      startIndex: chapter.startIndex,
      endIndex: chapter.endIndex,
    };
  });
  const persisted = await persistEpisodeSplits({
    userId: project.userId,
    projectId: project.id,
    manuscriptId: manuscript.id,
    episodes,
  });
  console.log(
    `导入完成：已在“${project.name}”创建 ${persisted.length} 个剧集（第 ${startEpisode}-${endEpisode} 集）。`,
  );
}

async function listProjects() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      userId: true,
      user: { select: { displayName: true, email: true } },
      _count: { select: { episodes: true } },
    },
  });
  return projects.map((project) => ({
    ...project,
    owner: project.user.email || project.user.displayName,
  }));
}

async function selectProject(selector?: string): Promise<ProjectChoice> {
  const projects = await listProjects();
  if (!projects.length) throw new Error("数据库中没有项目，请先在网页中创建项目");
  if (selector) {
    const exactId = projects.find((project) => project.id === selector);
    if (exactId) return exactId;
    const named = projects.filter((project) => project.name === selector);
    if (named.length === 1) return named[0];
    if (named.length > 1) throw new Error(`有多个同名项目“${selector}”，请改用项目 ID`);
    throw new Error(`找不到项目：${selector}`);
  }
  if (projects.length === 1) return projects[0];

  console.log("\n可用项目：");
  projects.forEach((project, index) => {
    console.log(
      `  ${index + 1}. ${project.name} | ${project.owner} | ${project._count.episodes} 集 | ${project.id}`,
    );
  });
  const selected = await chooseIndex("选择目标项目编号：", projects.length);
  return projects[selected - 1];
}

async function selectNovelFile(sourceOption?: string) {
  const defaultSource =
    process.env.NOVEL_SOURCE_DIR ??
    (process.platform === "win32" ? "D:\\小说" : resolve("novels"));
  const sourcePath = resolve(sourceOption ?? defaultSource);
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat) throw new Error(`小说路径不存在：${sourcePath}`);
  if (sourceStat.isFile()) {
    if (extname(sourcePath).toLowerCase() !== ".txt")
      throw new Error("目前只支持 TXT 小说");
    return sourcePath;
  }
  if (!sourceStat.isDirectory()) throw new Error(`小说路径不可读取：${sourcePath}`);

  const files = (await readdir(sourcePath, { withFileTypes: true }))
    .filter(
      (entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".txt",
    )
    .map((entry) => resolve(sourcePath, entry.name))
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
  if (!files.length) throw new Error(`目录中没有 TXT 小说：${sourcePath}`);
  if (files.length === 1) return files[0];

  console.log("可用小说：");
  files.forEach((file, index) => console.log(`  ${index + 1}. ${basename(file)}`));
  const selected = await chooseIndex("选择小说编号：", files.length);
  return files[selected - 1];
}

function decodeNovel(bytes: Uint8Array) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      encoding: "UTF-8 BOM",
      text: new TextDecoder("utf-8").decode(bytes.subarray(3)),
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      encoding: "UTF-16 LE",
      text: new TextDecoder("utf-16le").decode(bytes.subarray(2)),
    };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      encoding: "UTF-16 BE",
      text: new TextDecoder("utf-16be").decode(bytes.subarray(2)),
    };
  }
  try {
    return {
      encoding: "UTF-8",
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return {
      encoding: "GB18030",
      text: new TextDecoder("gb18030").decode(bytes),
    };
  }
}

function printVolumes(
  volumes: ReturnType<typeof parseNovelStructure>["volumes"],
) {
  volumes.forEach((volume) => {
    const first = volume.chapters[0]?.heading ?? "无章节";
    const last = volume.chapters.at(-1)?.heading ?? "无章节";
    console.log(
      `  ${volume.index}. ${volume.title} | ${volume.chapters.length} 章 | ${first} -> ${last}`,
    );
  });
}

async function chooseIndex(message: string, maximum: number) {
  const answer = (await ask(message)).trim();
  const selected = Number(answer);
  if (!Number.isInteger(selected) || selected < 1 || selected > maximum)
    throw new Error(`请输入 1 到 ${maximum} 之间的编号`);
  return selected;
}

async function ask(message: string) {
  if (!process.stdin.isTTY)
    throw new Error("当前终端不可交互，请通过命令参数提供选择");
  prompt ??= createInterface({ input: process.stdin, output: process.stdout });
  return prompt.question(message);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    scanOnly: false,
    yes: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const next = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${argument} 缺少参数值`);
      index += 1;
      return value;
    };
    if (argument === "--source") options.source = next();
    else if (argument === "--project") options.project = next();
    else if (argument === "--volumes") options.volumes = next();
    else if (argument === "--start") options.start = Number(next());
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--scan-only") options.scanOnly = true;
    else if (argument === "--yes" || argument === "-y") options.yes = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`
用法：pnpm novel:import [参数]

参数：
  --source <路径>    TXT 文件或目录，默认 D:\\小说
  --project <值>     目标项目 ID 或唯一项目名
  --volumes <选择>   卷编号，例如 1,3、1-2 或 all
  --start <集数>     起始剧集编号，默认接在项目最后一集之后
  --dry-run          生成导入计划并检查冲突，但不写数据库
  --scan-only        只检测卷和章节，不写数据库
  --yes, -y          跳过最终确认
  --help, -h         显示帮助
`);
}

main()
  .catch((error) => {
    console.error(`\n导入失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    prompt?.close();
    await prisma.$disconnect();
  });
