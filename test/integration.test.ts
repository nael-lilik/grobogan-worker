import { Executor } from '../src/executors/executor';
import { Config } from '../src/config';
import { WHITELISTED_COMMANDS } from '../src/types';

describe('Worker Executor Tests', () => {
  const config = new Config();
  
  it('should initialize executor correctly', () => {
    const executor = new Executor(config);
    expect(executor).toBeDefined();
  });

  it('should validate whitelisted commands', () => {
    expect(WHITELISTED_COMMANDS.length).toBeGreaterThan(10);
    
    const nmapCommand = WHITELISTED_COMMANDS.find(c => c.name === 'nmap');
    expect(nmapCommand).toBeDefined();
    expect(nmapCommand?.allowed).toBe(true);
    
    const unknownCommand = WHITELISTED_COMMANDS.find(c => c.name === 'unknown_tool');
    expect(unknownCommand).toBeUndefined();
  });

  it('should correctly extract command name', () => {
    const executor = new Executor(config);
    
    // Test with simple command
    expect(executor['extractCommandName']('nmap -Pn 192.168.1.1')).toBe('nmap');
    
    // Test with complex command
    expect(executor['extractCommandName']('curl -s http://example.com')).toBe('curl');
    
    // Test with no command
    expect(executor['extractCommandName']('')).toBe('unknown');
  });

  it('should correctly parse command arguments', () => {
    const executor = new Executor(config);
    
    // Test with arguments
    expect(executor['parseCommandArgs']('nmap -Pn 192.168.1.1')).toEqual(['-Pn', '192.168.1.1']);
    
    // Test with no arguments
    expect(executor['parseCommandArgs']('curl')).toEqual([]);
    
    // Test with multiple arguments
    expect(executor['parseCommandArgs']('ping -c 5 192.168.1.1')).toEqual(['-c', '5', '192.168.1.1']);
  });
});

describe('Worker Config Tests', () => {
  const savedManagerUrl = process.env.MANAGER_URL;

  beforeAll(() => {
    delete process.env.MANAGER_URL;
  });

  afterAll(() => {
    if (savedManagerUrl) process.env.MANAGER_URL = savedManagerUrl;
  });

  it('should create config with default values', () => {
    const config = new Config();

    expect(config.managerUrl).toBe('http://localhost:8080');
    expect(config.workerId).toMatch(/^worker-/);
    expect(config.capabilities).toContain('nmap');
    expect(config.capabilities).toContain('curl');
  });

  it('should parse capabilities correctly', () => {
    const originalEnv = process.env.CAPABILITIES;
    
    // Test with custom capabilities
    process.env.CAPABILITIES = 'nmap,sqlmap,custom_tool';
    const config = new Config();
    expect(config.capabilities).toEqual(['nmap', 'sqlmap', 'custom_tool']);
    
    // Restore original
    process.env.CAPABILITIES = originalEnv;
  });
});