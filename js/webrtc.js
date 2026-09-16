/**
 * Universal Share - WebRTC P2P Transport Layer
 * Provides reliable, high-throughput SCTP data streaming over DTLS/UDP.
 * Optimized for local Wi-Fi / Hotspot peer connections with full backpressure control.
 */

class UniWebRTC {
  constructor(options = {}) {
    this.options = Object.assign({
      iceServers: [
        // Free public STUN servers for NAT traversal if internet is present;
        // if offline / local Wi-Fi, host candidates (LAN IPs) are used automatically.
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      bufferedThreshold: 8 * 1024 * 1024,      // 8 MB max buffer limit
      lowThreshold: 2 * 1024 * 1024            // 2 MB resume threshold
    }, options);

    this.pc = null;
    this.dataChannel = null;
    this.isInitiator = false;
    this.connected = false;

    // Callbacks
    this.onConnectionState = () => {};
    this.onDataChannelOpen = () => {};
    this.onDataChannelClose = () => {};
    this.onMessage = () => {};
    this.onError = () => {};
  }

  /**
   * Initializes the RTCPeerConnection instance.
   */
  initPeerConnection() {
    if (this.pc) {
      this.close();
    }

    const config = {
      iceServers: this.options.iceServers,
      iceCandidatePoolSize: 2
    };

    this.pc = new RTCPeerConnection(config);

    this.pc.oniceconnectionstatechange = () => {
      this._handleIceStateChange();
    };

    this.pc.onconnectionstatechange = () => {
      this._handleConnectionStateChange();
    };

    // If receiver, handle remote data channel
    this.pc.ondatachannel = (event) => {
      this._setupDataChannel(event.channel);
    };
  }

  /**
   * Creates an SDP Offer and waits until ICE gathering completes.
   * This yields a self-contained SDP containing all local host candidates
   * suitable for 1-step serverless QR code pairing.
   * @returns {Promise<RTCSessionDescriptionInit>}
   */
  async createOffer() {
    this.isInitiator = true;
    this.initPeerConnection();

    // Initiator creates data channel
    const dc = this.pc.createDataChannel('unishare-data', {
      ordered: true
    });
    this._setupDataChannel(dc);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for ICE candidate gathering to finish
    await this._waitForIceGatheringComplete();

    return this.pc.localDescription;
  }

  /**
   * Sets remote offer and creates an SDP Answer, waiting for ICE gathering.
   * @param {RTCSessionDescriptionInit} offer 
   * @returns {Promise<RTCSessionDescriptionInit>}
   */
  async handleOfferAndCreateAnswer(offer) {
    this.isInitiator = false;
    this.initPeerConnection();

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    await this._waitForIceGatheringComplete();
    return this.pc.localDescription;
  }

  /**
   * Sets remote answer on initiator.
   * @param {RTCSessionDescriptionInit} answer 
   */
  async handleAnswer(answer) {
    if (!this.pc) throw new Error('PeerConnection not initialized');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Waits for complete local ICE candidate gathering.
   * @private
   */
  _waitForIceGatheringComplete() {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      this.pc.addEventListener('icegatheringstatechange', checkState);

      // Safety timeout in case STUN is unreachable (e.g. offline Wi-Fi)
      setTimeout(() => {
        this.pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, 1500);
    });
  }

  /**
   * Configures RTCDataChannel properties and backpressure handlers.
   * @private
   */
  _setupDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = this.options.lowThreshold;

    this.dataChannel.onopen = () => {
      this.connected = true;
      this.onDataChannelOpen();
    };

    this.dataChannel.onclose = () => {
      this.connected = false;
      this.onDataChannelClose();
    };

    this.dataChannel.onerror = (err) => {
      console.error('DataChannel error:', err);
      this.onError(err);
    };

    this.dataChannel.onmessage = (event) => {
      this.onMessage(event.data);
    };
  }

  /**
   * Sends data with active backpressure control.
   * If bufferedAmount exceeds the high threshold, pauses and waits for
   * 'bufferedamountlow' event to prevent browser memory exhaustion.
   * @param {ArrayBuffer|Uint8Array|string} data 
   */
  async send(data) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('DataChannel is not open');
    }

    if (this.dataChannel.bufferedAmount > this.options.bufferedThreshold) {
      await new Promise((resolve) => {
        const onLow = () => {
          this.dataChannel.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        this.dataChannel.addEventListener('bufferedamountlow', onLow);
      });
    }

    this.dataChannel.send(data);
  }

  _handleIceStateChange() {
    const state = this.pc.iceConnectionState;
    this.onConnectionState(state);
    if (state === 'failed' || state === 'disconnected') {
      this.connected = false;
    }
  }

  _handleConnectionStateChange() {
    const state = this.pc.connectionState;
    this.onConnectionState(state);
    if (state === 'connected') {
      this.connected = true;
    } else if (state === 'failed' || state === 'closed') {
      this.connected = false;
    }
  }

  /**
   * Closes all channels and peer connection.
   */
  close() {
    this.connected = false;
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (e) {}
      this.dataChannel = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch (e) {}
      this.pc = null;
    }
  }
}

if (typeof window !== 'undefined') {
  window.UniWebRTC = UniWebRTC;
}
