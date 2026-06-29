"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Executor = void 0;
const child_process_1 = require("child_process");
const types_1 = require("../types");
class Executor {
    constructor(_config) {
        this.activeProcesses = new Map();
        this.onLog = null;
        this.taskOutputs = new Map();
    }
    setLogCallback(cb) {
        this.onLog = cb;
    }
    async execute(task) {
        const taskId = task.taskId || task.id;
        const { type, command, options } = task;
        let logCount = 0;
        this.taskOutputs.set(taskId, { rawOutput: '', errorOutput: '' });
        if (!taskId || !type || !command) {
            throw new Error('Invalid task: missing required properties');
        }
        // Special handling for URL-based scripts: bash -c __URL_SCRIPT__:base64(url)
        const urlMatch = command.match(/^bash -c __URL_SCRIPT__:([A-Za-z0-9+/=]+)$/);
        if (urlMatch) {
            const targetArg = options?.targetAddress || '';
            const scriptCmd = Buffer.from(urlMatch[1], 'base64').toString('utf8');
            const fullCmd = `${scriptCmd} ${targetArg}`;
            return this.executeBashScript(taskId, type, fullCmd);
        }
        const commandName = this.extractCommandName(command);
        const whitelistedCommand = types_1.WHITELISTED_COMMANDS.find(c => c.name === commandName);
        if (!whitelistedCommand) {
            throw new Error(`Command '${commandName}' is not allowed`);
        }
        if (!whitelistedCommand.allowed) {
            throw new Error(`Command '${commandName}' is not permitted`);
        }
        this.sendLog({ taskId, message: `Starting task: ${type}`, level: 'info', timestamp: new Date().toISOString() });
        logCount++;
        this.sendLog({ taskId, message: `Executing: ${command}`, level: 'info', timestamp: new Date().toISOString() });
        logCount++;
        const args = this.parseCommandArgs(command);
        return this.spawnProcess(taskId, commandName, args, logCount);
    }
    async executeBashScript(taskId, type, scriptCmd) {
        this.sendLog({ taskId, message: `Starting task: ${type}`, level: 'info', timestamp: new Date().toISOString() });
        let logCount = 1;
        this.sendLog({ taskId, message: `Fetching & running script: ${scriptCmd.substring(0, 80)}${scriptCmd.length > 80 ? '...' : ''}`, level: 'info', timestamp: new Date().toISOString() });
        logCount++;
        return this.spawnProcess(taskId, 'bash', ['-c', scriptCmd], logCount);
    }
    spawnProcess(taskId, cmd, args, initialLogCount) {
        let logCount = initialLogCount;
        const outputs = this.taskOutputs.get(taskId);
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const process = (0, child_process_1.spawn)(cmd, args);
            this.activeProcesses.set(taskId, process);
            process.stdout.on('data', (data) => {
                const output = data.toString();
                outputs.rawOutput += output;
                this.sendLog({ taskId, message: output.trim(), level: 'info', timestamp: new Date().toISOString() });
                logCount++;
            });
            process.stderr.on('data', (data) => {
                const error = data.toString();
                outputs.errorOutput += error;
                this.sendLog({ taskId, message: error.trim(), level: 'error', timestamp: new Date().toISOString() });
                logCount++;
            });
            process.on('close', (code) => {
                const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                if (code === 0) {
                    this.sendLog({ taskId, message: `Task completed successfully in ${duration}s`, level: 'info', timestamp: new Date().toISOString() });
                    resolve({ taskId, rawOutput: outputs.rawOutput, summary: `Task completed in ${duration}s with ${logCount} log entries` });
                }
                else {
                    this.sendLog({ taskId, message: `Task failed with exit code ${code} after ${duration}s`, level: 'error', timestamp: new Date().toISOString() });
                    reject(new Error(outputs.errorOutput || `Command exited with code ${code}`));
                }
                this.activeProcesses.delete(taskId);
                this.taskOutputs.delete(taskId);
            });
            process.on('error', (error) => {
                this.sendLog({ taskId, message: `Process error: ${error.message}`, level: 'error', timestamp: new Date().toISOString() });
                reject(error);
                this.activeProcesses.delete(taskId);
                this.taskOutputs.delete(taskId);
            });
        });
    }
    async cancel(taskId) {
        const process = this.activeProcesses.get(taskId);
        if (process) {
            process.kill('SIGTERM');
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (!process.killed) {
                process.kill('SIGKILL');
            }
            this.activeProcesses.delete(taskId);
        }
    }
    extractCommandName(command) {
        const match = command.match(/^(\w+)/);
        return match ? match[1] : 'unknown';
    }
    parseCommandArgs(command) {
        const parts = command.split(' ').slice(1);
        return parts.filter(part => part.length > 0);
    }
    sendLog(log) {
        if (this.onLog) {
            this.onLog(log);
        }
        console.log(`[${log.level.toUpperCase()}] [${log.taskId}] ${log.message}`);
    }
    getActiveTaskId() {
        return Array.from(this.activeProcesses.keys())[0] || null;
    }
}
exports.Executor = Executor;
//# sourceMappingURL=executor.js.map