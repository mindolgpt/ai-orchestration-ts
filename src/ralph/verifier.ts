import { execSync } from "child_process";

export interface VerifierOptions {
  projectRoot: string;
}

export class Verifier {
  constructor(private options: VerifierOptions) {}

  async verifyBuild(): Promise<boolean> {
    try {
      execSync("npm run build", { cwd: this.options.projectRoot, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async verifyLint(): Promise<boolean> {
    try {
      execSync("npm run lint", { cwd: this.options.projectRoot, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async verifyTests(): Promise<boolean> {
    try {
      execSync("npm test -- --run", { cwd: this.options.projectRoot, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async verifyAll(): Promise<{ build: boolean; lint: boolean; tests: boolean }> {
    const results = await Promise.all([
      this.verifyBuild(),
      this.verifyLint(),
      this.verifyTests()
    ]);
    return {
      build: results[0],
      lint: results[1],
      tests: results[2]
    };
  }
}

export function createVerifier(projectRoot: string): Verifier {
  return new Verifier({ projectRoot });
}
