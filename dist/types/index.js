"use strict";
/**
 * Worker types and interfaces
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHITELISTED_COMMANDS = void 0;
exports.WHITELISTED_COMMANDS = [
    { name: 'nmap', description: 'Network scanning tool', allowed: true },
    { name: 'nikto', description: 'Web server scanner', allowed: true },
    { name: 'gobuster', description: 'Directory/file busting tool', allowed: true },
    { name: 'sqlmap', description: 'SQL injection scanner', allowed: true },
    { name: 'curl', description: 'HTTP client', allowed: true },
    { name: 'jq', description: 'JSON processor', allowed: true },
    { name: 'ssh', description: 'Secure shell client', allowed: true },
    { name: 'ping', description: 'Network connectivity tool', allowed: true },
    { name: 'telnet', description: 'Telnet client', allowed: true },
    { name: 'whois', description: 'WHOIS lookup tool', allowed: true },
    { name: 'dig', description: 'DNS lookup tool', allowed: true },
    { name: 'netcat', description: 'Network utility tool', allowed: true },
    { name: 'masscan', description: 'High-speed port scanner', allowed: true },
    { name: 'sslscan', description: 'SSL/TLS scanner', allowed: true },
    { name: 'whatweb', description: 'Website technology fingerprinting', allowed: true },
    { name: 'openvas', description: 'OpenVAS vulnerability scanner', allowed: true },
    { name: 'nessus', description: 'Nessus vulnerability scanner', allowed: true },
    { name: 'acunetix', description: 'Web vulnerability scanner', allowed: true },
];
//# sourceMappingURL=index.js.map