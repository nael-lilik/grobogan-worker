export declare class Config {
    readonly managerUrl: string;
    readonly workerId: string;
    readonly hostname: string;
    readonly ip: string;
    readonly capabilities: string[];
    readonly heartBeatInterval: number;
    readonly taskRequestInterval: number;
    readonly maxConcurrentTasks: number;
    constructor();
    private getIPAddress;
    private parseCapabilities;
    /** Detect which capabilities are actually installed on the system */
    detectActualCapabilities(): Promise<string[]>;
    /** Per-tool health: installed on PATH AND actually executable */
    checkCapabilityHealth(): Promise<CapabilityHealth[]>;
}
export interface CapabilityHealth {
    name: string;
    installed: boolean;
    working: boolean;
    version?: string;
    error?: string;
}
export declare const config: Config;
//# sourceMappingURL=config.d.ts.map