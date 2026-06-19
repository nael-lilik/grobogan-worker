"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const worker_client_1 = require("./socket/worker-client");
const workerMap = new Map();
async function main() {
    console.log('Grobogan Worker Agent v0.1.0');
    console.log('=============================');
    console.log('');
    const config = new config_1.Config();
    console.log('Configuration:');
    console.log(`  Worker ID: ${config.workerId}`);
    console.log(`  Hostname: ${config.hostname}`);
    console.log(`  IP: ${config.ip}`);
    console.log(`  Manager URL: ${config.managerUrl}`);
    console.log(`  Capabilities: ${config.capabilities.join(', ')}`);
    console.log(`  Max Concurrent Tasks: ${config.maxConcurrentTasks}`);
    console.log(`  Heartbeat Interval: ${config.heartBeatInterval}ms`);
    console.log(`  Task Request Interval: ${config.taskRequestInterval}ms`);
    console.log('');
    const worker = new worker_client_1.WorkerClient(config);
    workerMap.set(config.workerId, worker);
    worker.connect();
    // Send initial status
    worker.emitStatus();
    // Start heartbeat interval
    const heartbeatInterval = setInterval(() => {
        worker.emitHeartbeat();
    }, config.heartBeatInterval);
    // Start task request loop — request tasks when below capacity
    const taskRequestInterval = setInterval(() => {
        if (worker.getActiveTaskCount() < config.maxConcurrentTasks) {
            worker.requestTask();
        }
    }, config.taskRequestInterval);
    // Graceful shutdown handler
    const shutdown = async () => {
        console.log('\nShutting down...');
        clearInterval(heartbeatInterval);
        clearInterval(taskRequestInterval);
        worker.destroy();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
        console.error('Uncaught exception:', error);
    });
    process.on('unhandledRejection', (error) => {
        console.error('Unhandled rejection:', error);
    });
}
main().catch((error) => {
    console.error('Failed to start worker:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map