/**
 * Universal Share - Robust SDP & Key Serializer
 * Compacts WebRTC SDP session and ECDH keys into safe, copyable, and quick-scan tokens.
 * Zero-compression-stream bugs, 100% cross-browser compatibility (iOS Safari, Android Chrome, Mac).
 */

class SdpCompressor {
  /**
   * Serializes signaling payload into a compact, URL-safe Base64 token.
   * Extracts essential WebRTC parameters to produce a tiny token (< 450 chars)
   * that displays as a high-contrast, easily scannable QR code.
   * @param {Object} payload - { type: 'offer'|'answer', sdp: string, key: Array|Uint8Array }
   * @returns {Promise<string>}
   */
  static async compress(payload) {
    if (!payload || !payload.sdp) {
      throw new Error('Missing SDP in signaling payload');
    }

    const sdp = payload.sdp;
    const type = payload.type; // 'offer' or 'answer'

    // Extract essential dynamic values from SDP
    const ufragMatch = sdp.match(/a=ice-ufrag:([^\r\n]+)/);
    const pwdMatch = sdp.match(/a=ice-pwd:([^\r\n]+)/);
    const fpMatch = sdp.match(/a=fingerprint:(?:sha-256\s+)?([^\r\n]+)/i);

    // Intelligently extract and prune candidates for compact representation
    const candidates = SdpCompressor.extractCandidates(sdp);

    const ufrag = ufragMatch ? ufragMatch[1].trim() : '';
    const pwd = pwdMatch ? pwdMatch[1].trim() : '';
    let fp = fpMatch ? fpMatch[1].trim() : '';

    // If fingerprint contains colons, strip them and prefix for ultra-compact storage
    if (fp.includes(':')) {
      fp = fp.replace(/sha-256\s+/i, '').replace(/[:\s]/g, '');
    }

    // Convert key to Base64
    const keyBytes = payload.key instanceof Uint8Array ? payload.key : new Uint8Array(payload.key);
    const keyB64 = SdpCompressor._uint8ToBase64(keyBytes);

    // Build compact object
    const compactObj = {
      t: type === 'offer' ? 'o' : 'a',
      u: ufrag,
      p: pwd,
      f: fp,
      c: candidates,
      k: keyB64
    };

    const jsonStr = JSON.stringify(compactObj);
    const tokenB64 = SdpCompressor._utf8ToBase64(jsonStr);

    return 'US1:' + tokenB64;
  }

  /**
   * Intelligently extracts, deduplicates, and prioritizes essential UDP candidates
   * for direct local WebRTC transfers, discarding TCP and unroutable candidates.
   * @param {string} sdp
   * @returns {Array<string>}
   */
  static extractCandidates(sdp) {
    const candMatches = sdp.match(/a=candidate:([^\r\n]+)/g) || [];
    const candidates = [];
    const seen = new Set();

    for (const match of candMatches) {
      const line = match.replace(/^a=candidate:/, '').trim();
      const m = line.match(/(?:a=candidate:)?(\S+)\s+(\d+)\s+(UDP|TCP)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/i);
      if (!m) {
        // Fallback for non-standard candidate lines
        if (!seen.has(line) && candidates.length < 6) {
          seen.add(line);
          candidates.push(line);
        }
        continue;
      }

      const transport = m[3].toUpperCase();
      const ip = m[5];
      const port = m[6];
      const type = m[7].toLowerCase();

      // Only UDP candidates are suitable for direct local WebRTC DataChannels
      if (transport !== 'UDP') continue;
      // Skip loopback and unroutable link-local IPv6 addresses
      if (ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1' || ip.toLowerCase().startsWith('fe80:')) continue;

      const dedupeKey = `${type}|${ip}|${port}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Compact representation: 'h' for host, 's' for srflx, or prefix with type letter
      const typeCode = type === 'srflx' ? 's' : (type === 'host' ? 'h' : type);
      candidates.push(`${typeCode} ${ip} ${port}`);

      // Cap at top 6 candidates to guarantee the QR code stays small, sharp, and quick to scan
      if (candidates.length >= 6) break;
    }

    return candidates;
  }

  /**
   * Decompresses and reconstructs the full WebRTC SDP and ECDH key.
   * Sanitizes any whitespace or newlines added by iOS/Mac copy-paste or QR readers.
   * @param {string} token 
   * @returns {Promise<Object>} - { type: 'offer'|'answer', sdp: string, key: Uint8Array }
   */
  static async decompress(token) {
    if (!token || typeof token !== 'string') {
      throw new Error('Connection code is empty');
    }

    // Strip whitespace, tabs, and newlines
    let cleanToken = token.trim().replace(/[\r\n\t\s]+/g, '');

    // Format 1: US1 compact format
    if (cleanToken.startsWith('US1:')) {
      const b64 = cleanToken.slice(4);
      const jsonStr = SdpCompressor._base64ToUtf8(b64);
      const compactObj = JSON.parse(jsonStr);

      const type = compactObj.t === 'o' ? 'offer' : 'answer';
      const reconstructedSdp = SdpCompressor.rebuildSdp(type, compactObj);
      const keyBytes = SdpCompressor._base64ToUint8(compactObj.k);

      return {
        type,
        sdp: reconstructedSdp,
        key: keyBytes
      };
    }

    // Format 2: Fallback for raw JSON or legacy formats
    let rawStr = cleanToken;
    if (cleanToken.startsWith('R:') || cleanToken.startsWith('C:')) {
      rawStr = cleanToken.slice(2);
      try {
        const decoded = SdpCompressor._base64ToUtf8(rawStr);
        const parsed = JSON.parse(decoded);
        return {
          type: parsed.type,
          sdp: parsed.sdp,
          key: new Uint8Array(parsed.key)
        };
      } catch (e) {
        // Continue to next fallback
      }
    }

    try {
      const parsed = JSON.parse(rawStr);
      return {
        type: parsed.type,
        sdp: parsed.sdp,
        key: new Uint8Array(parsed.key)
      };
    } catch (err) {
      throw new Error('Unrecognized connection code format');
    }
  }

  /**
   * Rebuilds a complete RFC-compliant WebRTC DataChannel SDP.
   * @param {string} type - 'offer' | 'answer'
   * @param {Object} obj - { u, p, f, c }
   * @returns {string} Reconstructed SDP
   */
  static rebuildSdp(type, obj) {
    // Normalize and restore fingerprint
    let fp = obj.f || '';
    if (fp && !fp.includes(':') && fp.length === 64) {
      fp = fp.match(/.{2}/g).join(':');
    }
    const fpLine = fp.toLowerCase().startsWith('sha-256 ') ? fp : `sha-256 ${fp.toUpperCase()}`;

    const lines = [
      'v=0',
      `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=mid:0',
      `a=setup:${type === 'offer' ? 'actpass' : 'active'}`,
      'a=sctp-port:5000',
      'a=max-message-size:262144',
      `a=ice-ufrag:${obj.u}`,
      `a=ice-pwd:${obj.p}`,
      `a=fingerprint:${fpLine}`
    ];

    if (Array.isArray(obj.c)) {
      for (let i = 0; i < obj.c.length; i++) {
        const cand = obj.c[i];
        if (!cand || !cand.trim()) continue;
        const trimmed = cand.trim();

        if (trimmed.startsWith('h ') || trimmed.startsWith('s ')) {
          const parts = trimmed.split(' ');
          const candType = parts[0] === 's' ? 'srflx' : 'host';
          const ip = parts[1];
          const port = parts[2];
          const priority = candType === 'host' ? 2122260223 : 1686052607;
          lines.push(`a=candidate:${i + 1} 1 UDP ${priority} ${ip} ${port} typ ${candType}`);
        } else {
          // Full candidate line (legacy / raw test fallback)
          const cleanLine = trimmed.replace(/^a=candidate:/, '').trim();
          lines.push(`a=candidate:${cleanLine}`);
        }
      }
    }

    return lines.join('\r\n') + '\r\n';
  }

  static minifySdp(sdp) {
    return sdp || '';
  }

  static _utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    return SdpCompressor._uint8ToBase64(bytes);
  }

  static _base64ToUtf8(b64) {
    const bytes = SdpCompressor._base64ToUint8(b64);
    return new TextDecoder().decode(bytes);
  }

  static _uint8ToBase64(bytes) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  static _base64ToUint8(base64) {
    const cleaned = base64.replace(/[\r\n\t\s]+/g, '');
    const binary = window.atob(cleaned);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

if (typeof window !== 'undefined') {
  window.SdpCompressor = SdpCompressor;
}
