import path from "node:path";
import { logFileTimestamp } from "./logger";
export const currentDir = path.resolve(new URL(import.meta.url).pathname, "..");

export interface Config {
  readonly logDir: string;
}

export class LogicTestingConfig implements Config {
  logDir = path.resolve(
    currentDir,
    "..",
    "logs",
    "logic-testing",
    `${logFileTimestamp()}.log`
  );
  constructor() {}
}
