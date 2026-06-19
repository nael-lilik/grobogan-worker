"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Executor = void 0;
const child_process_1 = require("child_process");
const types_1 = require("../types");
class Executor {
    constructor(_config) {
        this.activeProcesses = new Map();
        this.onLog = null;
    }
    setLogCallback(cb) {
        this.onLog = cb;
    }
    async execute(task) {
        const taskId = task.taskId || task.id;
        const { type, command } = task;
        let logCount = 0;
        let rawOutput = '';
        let errorOutput = '';
        // Validate that task has required properties
        if (!taskId || !type || !command) {
            throw new Error('Invalid task: missing required properties');
        }
        // Validate command against whitelist
        const commandName = this.extractCommandName(command);
        const whitelistedCommand = types_1.WHITELISTED_COMMANDS.find(c => c.name === commandName);
        if (!whitelistedCommand) {
            throw new Error(`Command '${commandName}' is not allowed`);
        }
        if (!whitelistedCommand.allowed) {
            throw new Error(`Command '${commandName}' is not permitted`);
        }
        // Log task start
        this.sendLog({
            taskId,
            message: `Starting task: ${type}`,
            level: 'info',
            timestamp: new Date().toISOString(),
        });
        logCount++;
        this.sendLog({
            taskId,
            message: `Executing command: ${command}`,
            level: 'info',
            timestamp: new Date().toISOString(),
        });
        logCount++;
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const process = (0, child_process_1.spawn)(commandName, this.parseCommandArgs(command));
            this.activeProcesses.set(taskId, process);
            process.stdout.on('data', (data) => {
                const output = data.toString();
                rawOutput += output;
                const log = {
                    taskId,
                    message: output.trim(),
                    level: 'info',
                    timestamp: new Date().toISOString(),
                };
                this.sendLog(log);
                logCount++;
            });
            process.stderr.on('data', (data) => {
                const error = data.toString();
                errorOutput += error;
                const log = {
                    taskId,
                    message: error.trim(),
                    level: 'error',
                    timestamp: new Date().toISOString(),
                };
                this.sendLog(log);
                logCount++;
            });
            process.on('close', (code) => {
                const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                if (code === 0) {
                    this.sendLog({
                        taskId,
                        message: `Task completed successfully in ${duration}s`,
                        level: 'info',
                        timestamp: new Date().toISOString(),
                    });
                    logCount++;
                    resolve({
                        taskId,
                        rawOutput,
                        summary: `Task completed in ${duration}s with ${logCount} log entries`,
                    });
                }
                else {
                    this.sendLog({
                        taskId,
                        message: `Task failed with exit code ${code} after ${duration}s`,
                        level: 'error',
                        timestamp: new Date().toISOString(),
                    });
                    logCount++;
                    reject(new Error(errorOutput || `Command exited with code ${code}`));
                }
                this.activeProcesses.delete(taskId);
            });
            process.on('error', (error) => {
                this.sendLog({
                    taskId,
                    message: `Process error: ${error.message}`,
                    level: 'error',
                    timestamp: new Date().toISOString(),
                });
                logCount++;
                reject(error);
                this.activeProcesses.delete(taskId);
            });
        });
    }
    async cancel(taskId) {
        const process = this.activeProcesses.get(taskId);
        if (process) {
            process.kill('SIGTERM');
            // Wait a bit and then force kill if needed
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