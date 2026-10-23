"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCpuUsage = getCpuUsage;
exports.getMemoryUsage = getMemoryUsage;
exports.getDiskUsage = getDiskUsage;
exports.collectSystemResources = collectSystemResources;
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
let previousCpuInfo = null;
function getCpuSnapshot() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
        for (const type in cpu.times) {
            total += cpu.times[type];
        }
        idle += cpu.times.idle;
    }
    return { idle, total };
}
function getCpuUsage() {
    const cores = os.cpus().length || 1;
    const current = getCpuSnapshot();
    if (!previousCpuInfo) {
        previousCpuInfo = current;
        // Initial load estimation via load average (1 min avg divided by cores)
        const load1 = os.loadavg()[0] || 0;
        const estimatedUsage = Math.min(100, Math.max(0, Math.round((load1 / cores) * 100)));
        return { usage: estimatedUsage, cores };
    }
    const idleDiff = current.idle - previousCpuInfo.idle;
    const totalDiff = current.total - previousCpuInfo.total;
    previousCpuInfo = current;
    if (totalDiff <= 0) {
        return { usage: 0, cores };
    }
    const usagePct = Math.min(100, Math.max(0, Math.round((1 - idleDiff / totalDiff) * 100)));
    return { usage: usagePct, cores };
}
function getMemoryUsage() {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const totalMB = Math.round(totalBytes / (1024 * 1024));
    const availableMB = Math.round(freeBytes / (1024 * 1024));
    const usagePct = totalBytes > 0 ? Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100))) : 0;
    return {
        usage: usagePct,
        total: totalMB,
        available: availableMB,
    };
}
function getDiskUsage(mountPath = '/') {
    try {
        if (typeof fs.statfsSync === 'function') {
            const stats = fs.statfsSync(mountPath);
            const totalBytes = stats.bsize * stats.blocks;
            const freeBytes = stats.bsize * stats.bavail;
            const usedBytes = Math.max(0, totalBytes - freeBytes);
            const totalMB = Math.round(totalBytes / (1024 * 1024));
            const availableMB = Math.round(freeBytes / (1024 * 1024));
            const usagePct = totalBytes > 0 ? Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100))) : 0;
            return {
                usage: usagePct,
                total: totalMB,
                available: availableMB,
            };
        }
    }
    catch {
        // fallback if statfsSync fails
    }
    // Graceful fallback if statfs is unavailable
    return {
        usage: 0,
        total: 0,
        available: 0,
    };
}
function collectSystemResources() {
    return {
        cpu: getCpuUsage(),
        memory: getMemoryUsage(),
        disk: getDiskUsage('/'),
    };
}
//# sourceMappingURL=system-resources.js.map