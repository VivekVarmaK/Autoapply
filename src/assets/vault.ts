import fs from "fs";
import path from "path";
import crypto from "crypto";
import { AppConfig } from "../config";
import { ResumeAsset } from "../types/context";

export interface AddResumeOptions {
  label: string;
  setDefault?: boolean;
}

export async function addResumeToVault(
  config: AppConfig,
  sourcePath: string,
  options: AddResumeOptions
): Promise<{ resume: ResumeAsset; config: AppConfig }> {
  ensureAssetsDir(config.app.assetsDir);

  const sourceStat = fs.statSync(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error("Resume path must be a file");
  }

  const sha256 = await computeSha256(sourcePath);
  const ext = path.extname(sourcePath) || ".pdf";
  const safeLabel = sanitizeLabel(options.label || "resume");
  const filename = `resume_${safeLabel}_${sha256.slice(0, 8)}${ext}`;
  const destPath = path.join(config.app.assetsDir, filename);

  fs.copyFileSync(sourcePath, destPath);

  const resume: ResumeAsset = {
    label: options.label,
    path: destPath,
    sha256,
    isDefault: Boolean(options.setDefault),
  };

  const updatedResumes = options.setDefault
    ? config.resumes.map((item) => ({ ...item, isDefault: false }))
    : config.resumes.slice();

  updatedResumes.push(resume);

  return {
    resume,
    config: {
      ...config,
      resumes: updatedResumes,
    },
  };
}

function ensureAssetsDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    return "resume";
  }

  return trimmed.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data: string | Buffer) => hash.update(data));
    stream.on("error", (error: Error) => reject(error));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
