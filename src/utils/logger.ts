/**
 * Sleek, premium console logger with color formatting using ANSI escape codes.
 */

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace("T", " ").substring(0, 19);
}

export const logger = {
  info: (message: string, moduleContext?: string, scope?: string) => {
    const mod = moduleContext ? `${colors.dim}[${moduleContext}]${colors.reset}`.padEnd(9 + colors.dim.length + colors.reset.length, " ") + " " : "";
    const scp = scope ? `${colors.magenta}[${scope}]${colors.reset} ` : "";
    console.log(
      `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.cyan}INFO   ${colors.reset} ${mod}${scp}${message}`
    );
  },

  success: (message: string, moduleContext?: string, scope?: string) => {
    const mod = moduleContext ? `${colors.dim}[${moduleContext}]${colors.reset}`.padEnd(9 + colors.dim.length + colors.reset.length, " ") + " " : "";
    const scp = scope ? `${colors.magenta}[${scope}]${colors.reset} ` : "";
    console.log(
      `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.green}${colors.bright}SUCCESS${colors.reset} ${mod}${scp}${message}`
    );
  },

  warn: (message: string, moduleContext?: string, scope?: string) => {
    const mod = moduleContext ? `${colors.dim}[${moduleContext}]${colors.reset}`.padEnd(9 + colors.dim.length + colors.reset.length, " ") + " " : "";
    const scp = scope ? `${colors.magenta}[${scope}]${colors.reset} ` : "";
    console.warn(
      `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.yellow}${colors.bright}WARN   ${colors.reset} ${mod}${scp}${message}`
    );
  },

  error: (message: string, error?: any, moduleContext?: string, scope?: string) => {
    const mod = moduleContext ? `${colors.dim}[${moduleContext}]${colors.reset}`.padEnd(9 + colors.dim.length + colors.reset.length, " ") + " " : "";
    const scp = scope ? `${colors.magenta}[${scope}]${colors.reset} ` : "";
    console.error(
      `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.red}${colors.bright}ERROR  ${colors.reset} ${mod}${scp}${message}`
    );
    if (error) {
      console.error(error);
    }
  },
};
