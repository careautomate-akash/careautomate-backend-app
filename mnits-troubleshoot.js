import fetch from 'node-fetch';
import net from 'net';
import dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

// Test 1: VPN Connection via Web Interface
try {
    const webResponse = await fetch('https://mn-its.dhs.state.mn.us/gatewayweb/login', {
        method: 'HEAD',
        timeout: 10000
    });

    if (webResponse.ok) {
    } else {
    }
} catch (error) {
}

// Test 2: DNS Resolution
try {
    const dnsResult = await dnsLookup('secureftp.dhs.state.mn.us');
} catch (error) {
}

// Test 3: TCP Connection on Different Ports
const portsToTest = [22, 2222, 21, 990, 443];

for (const port of portsToTest) {
    try {
        const tcpResult = await new Promise((resolve, reject) => {
            const socket = new net.Socket();
            let connected = false;

            socket.setTimeout(5000);

            socket.on('connect', () => {
                connected = true;
                socket.end();
                resolve({ connected: true, port });
            });

            socket.on('timeout', () => {
                socket.destroy();
                reject(new Error(`Connection timeout on port ${port}`));
            });

            socket.on('error', (err) => {
                socket.destroy();
                reject(err);
            });

            socket.connect(port, 'secureftp.dhs.state.mn.us');
        });

    } catch (error) {
    }
}

// Test 4: Alternative SFTP Server Addresses
const alternativeServers = [
    'secureftp.dhs.state.mn.us',
    'sftp.dhs.state.mn.us',
    'ftp.dhs.state.mn.us',
    'mn-its.dhs.state.mn.us'
];

for (const server of alternativeServers) {
    try {
        const dnsResult = await dnsLookup(server);

        // Test port 2222 on this server
        try {
            await new Promise((resolve, reject) => {
                const socket = new net.Socket();
                socket.setTimeout(3000);

                socket.on('connect', () => {
                    socket.end();
                    resolve();
                });

                socket.on('timeout', () => {
                    socket.destroy();
                    reject(new Error('timeout'));
                });

                socket.on('error', reject);
                socket.connect(2222, server);
            });

        } catch (portError) {
        }

    } catch (error) {
    }
}

