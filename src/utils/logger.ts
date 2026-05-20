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
  info: (message: string, context?: string) => {
    const ctx = context ? `${colors.dim}[${context}]${colors.reset} ` : "";
    console.log(
      `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.cyan}INFO${colors.reset}  ${ctx}${message}`
    );
  },

  success: (message: string, context?: string) => {
    const ctx = context ? `${colors.dim}[${context}]${colors.reset} ` : "";
    console.log(
      `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.green}${colors.bright}SUCCESS${colors.reset} ${ctx}${message}`
    );
  },

  warn: (message: string, context?: string) => {
    const ctx = context ? `${colors.dim}[${context}]${colors.reset} ` : "";
    console.warn(
      `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.yellow}${colors.bright}WARN${colors.reset}  ${ctx}${message}`
    );
  },

  error: (message: string, error?: any, context?: string) => {
    const ctx = context ? `${colors.dim}[${context}]${colors.reset} ` : "";
    console.error(
      `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.red}${colors.bright}ERROR${colors.reset} ${ctx}${message}`
    );
    if (error) {
      console.error(error);
    }
  },

  gemini: (message: string, context?: string) => {
    const ctx = context ? `${colors.dim}[${context}]${colors.reset} ` : "";
    console.log(
      `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.magenta}${colors.bright}GEMINI${colors.reset} ${ctx}${message}`
    );
  },
};
