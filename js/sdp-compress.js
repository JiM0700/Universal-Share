/**
 * Universal Share - SDP & Signaling Compressor
 * Compresses WebRTC SDP + ECDH public key into ultra-compact URL-safe strings
 * suited for QR Code display and camera scanning.
 */

class SdpCompressor {
  /**
   * Compresses a JSON signaling object { type, sdp, key } into a compact Base64 string.
   * Uses native CompressionStream('deflate') when available.
   * @param {Object} payload 
   * @returns {Promise<string>} Base64 compressed string
   */
  static async compress(payload) {
    const jsonStr = JSON.stringify(payload);
    const encoder = new TextEncoder();
    const data = encoder.encode(jsonStr);

    if (typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('deflate');
      const writer = cs.writable.getWriter();
      writer.write(data);
      writer.close();

      const compressedChunks = [];
      const reader = cs.readable.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        compressedChunks.push(value);
      }

      // Merge chunks
      const totalLength = compressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of compressedChunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      return 'C:' + SdpCompressor._uint8ToBase64(merged);
    } else {
      // Fallback: raw base64
      return 'R:' + SdpCompressor._uint8ToBase64(data);
    }
  }

  /**
   * Decompresses a Base64 string back into the original signaling object.
   * @param {string} encodedStr 
   * @returns {Promise<Object>}
   */
  static async decompress(encodedStr) {
    if (!encodedStr || typeof encodedStr !== 'string') {
      throw new Error('Invalid signaling string to decompress');
    }

    const mode = encodedStr.slice(0, 2);
    const b64 = encodedStr.slice(2);
    const bytes = SdpCompressor._base64ToUint8(b64);

    if (mode === 'C:') {
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();

        const chunks = [];
        const reader = ds.readable.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(merged));
      } else {
        throw new Error('DecompressionStream not supported in this browser.');
      }
    } else if (mode === 'R:') {
      const decoder = new TextDecoder();
      return JSON.parse(decoder.decode(bytes));
    } else {
      // Raw JSON fallback if uncompressed
      try {
        return JSON.parse(encodedStr);
      } catch (e) {
        throw new Error('Unrecognized signaling payload format');
      }
    }
  }

  /**
   * Minifies SDP text by stripping non-essential candidate lines and comments.
   * @param {string} sdp 
   * @returns {string}
   */
  static minifySdp(sdp) {
    if (!sdp) return '';
    return sdp
      .split('\r\n')
      .filter(line => {
        // Strip out rtcp, audio/video attributes if any leak through
        if (line.startsWith('a=candidate:')) {
          // Keep host (local LAN / Wi-Fi) and srflx candidates
          return line.includes('typ host') || line.includes('typ srflx');
        }
        return line.trim().length > 0;
      })
      .join('\r\n') + '\r\n';
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
    const binary = window.atob(base64);
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
