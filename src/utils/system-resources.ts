import * as os from 'os';
import * as fs from 'fs';

export interface SystemResourceMetrics {
  cpu: {
    usage: number; // 0 - 100
    cores: number;
  };
  memory: {
    usage: number; // 0 - 100
    total: number; // in MB to maintain socket schema compatibility
    available: number; // in MB
  };
  disk: {
    usage: number; // 0 - 100
    total: number; // in MB
    available: number; // in MB
  };
}

let previousCpuInfo: { idle: number; total: number } | null = null;

function getCpuSnapshot(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += (cpu.times as any)[type];
    }
    idle += cpu.times.idle;
  }

  return { idle, total };
}

export function getCpuUsage(): { usage: number; cores: number } {
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

export function getMemoryUsage(): { usage: number; total: number; available: number } {
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

export function getDiskUsage(mountPath: string = '/'): { usage: number; total: number; available: number } {
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
  } catch {
    // fallback if statfsSync fails
  }

  // Graceful fallback if statfs is unavailable
  return {
    usage: 0,
    total: 0,
    available: 0,
  };
}

export function collectSystemResources(): SystemResourceMetrics {
  return {
    cpu: getCpuUsage(),
    memory: getMemoryUsage(),
    disk: getDiskUsage('/'),
  };
}
