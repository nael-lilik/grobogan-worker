export interface SystemResourceMetrics {
    cpu: {
        usage: number;
        cores: number;
    };
    memory: {
        usage: number;
        total: number;
        available: number;
    };
    disk: {
        usage: number;
        total: number;
        available: number;
    };
}
export declare function getCpuUsage(): {
    usage: number;
    cores: number;
};
export declare function getMemoryUsage(): {
    usage: number;
    total: number;
    available: number;
};
export declare function getDiskUsage(mountPath?: string): {
    usage: number;
    total: number;
    available: number;
};
export declare function collectSystemResources(): SystemResourceMetrics;
//# sourceMappingURL=system-resources.d.ts.map