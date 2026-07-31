import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, "node_modules", "pdfjs-dist");
const targetRoot = path.join(
  projectRoot,
  "dist",
  "src",
  "vendor",
  "pdfjs"
);

await mkdir(targetRoot, { recursive: true });
const pdfSourcePath = path.join(
  sourceRoot,
  "legacy",
  "build",
  "pdf.mjs"
);
const canvasImportBlock = `    try {
      canvas = require("@napi-rs/canvas");
    } catch (ex) {
      warn(\`Cannot load "@napi-rs/canvas" package: "\${ex}".\`);
    }`;
const pdfSource = await readFile(pdfSourcePath, "utf8");
if (
  !pdfSource.includes(canvasImportBlock) ||
  pdfSource.indexOf(canvasImportBlock) !==
    pdfSource.lastIndexOf(canvasImportBlock)
) {
  throw new Error(
    "PDF.js 6.1.200 Node Canvas 导入片段发生漂移，拒绝生成未审计的文本解析资产。"
  );
}
const textOnlyPdfSource = pdfSource.replace(
  canvasImportBlock,
  "    // yuanzihao: text-only build; rendering canvas intentionally omitted."
);

await Promise.all([
  writeFile(
    path.join(targetRoot, "pdf.mjs"),
    textOnlyPdfSource,
    "utf8"
  ),
  cp(
    path.join(sourceRoot, "legacy", "build", "pdf.worker.mjs"),
    path.join(targetRoot, "pdf.worker.mjs")
  ),
  cp(
    path.join(sourceRoot, "LICENSE"),
    path.join(targetRoot, "LICENSE")
  ),
  cp(
    path.join(sourceRoot, "standard_fonts"),
    path.join(targetRoot, "standard_fonts"),
    { recursive: true }
  )
]);
