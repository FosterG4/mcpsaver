import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level?: LogLevel;
  toFile?: boolean;
  filePath?: string;
}

const levelOrder: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

export class Logger {
  private level: LogLevel;
  private toFile: boolean;
  private filePath?: string;

  constructor(config: LoggerConfig = {}) {
    this.level = config.level ?? 'info';
    this.toFile = Boolean(config.toFile);
    this.filePath = config.filePath;
  }

  updateConfig(config: LoggerConfig) {
    if (config.level) this.level = config.level;
    if (typeof config.toFile === 'boolean') this.toFile = config.toFile;
    if (config.filePath !== undefined) this.filePath = config.filePath;
  }

  private shouldLog(level: LogLevel): boolean {
    return levelOrder[level] >= levelOrder[this.level];
  }

  private write(level: LogLevel, message: string) {
    if (!this.shouldLog(level)) return;
    const ts = new Date().toISOString();
    const line = JSON.stringify({ ts, level, message });

    // Console output: always write to stderr to keep stdio protocol clean
    // MCP stdio transport expects stdout to be reserved strictly for protocol frames.
    // Using stderr for human-readable logs avoids corrupting the transport.
    console.error(line);

    // Optional file output
    if (this.toFile && this.filePath) {
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(this.filePath, line + '\n', { encoding: 'utf-8' });
      } catch {
        // Swallow file logging errors to avoid impacting main flow
      }
    }
  }

  trace(msg: string) { this.write('trace', msg); }
  debug(msg: string) { this.write('debug', msg); }
  info(msg: string) { this.write('info', msg); }
  warn(msg: string) { this.write('warn', msg); }
  error(msg: string) { this.write('error', msg); }
}
