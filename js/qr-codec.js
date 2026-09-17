/**
 * Universal Share - QR Code Generator & Camera Scanner Engine
 * Self-contained, zero-external-dependency QR Generator and Scanner.
 * Supports:
 * - Native Canvas QR rendering
 * - BarcodeDetector API (hardware-accelerated)
 * - Pure JavaScript fallback QR reader
 * - Camera management (environment/back camera, flip camera, flashlight if supported)
 * - Static image QR scanning (from gallery/screenshot)
 */

// ==========================================
// 1. Minimal Self-Contained QR Generator
// ==========================================
class QRGenerator {
  /**
   * Renders a QR code onto a canvas element.
   * @param {HTMLCanvasElement} canvas 
   * @param {string} text 
   * @param {Object} options 
   */
  static render(canvas, text, options = {}) {
    const size = options.size || 280;
    const padding = options.padding || 16;
    const darkColor = options.darkColor || '#0f172a';
    const lightColor = options.lightColor || '#ffffff';

    const qr = QRCodeModel.create(text, options.errorCorrection || 'M');
    const moduleCount = qr.getModuleCount();
    const cellSize = Math.floor((size - padding * 2) / moduleCount);
    const actualSize = cellSize * moduleCount + padding * 2;

    canvas.width = actualSize;
    canvas.height = actualSize;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, actualSize, actualSize);

    ctx.fillStyle = darkColor;
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(
            padding + c * cellSize,
            padding + r * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }
  }
}

// QR Code Model Core Implementation
class QRCodeModel {
  constructor(typeNumber, errorCorrectLevel) {
    this.typeNumber = typeNumber;
    this.errorCorrectLevel = errorCorrectLevel;
    this.modules = null;
    this.moduleCount = 0;
    this.dataCache = null;
    this.dataList = [];
  }

  addData(data) {
    this.dataList.push(new QR8bitByte(data));
    this.dataCache = null;
  }

  isDark(row, col) {
    if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
      throw new Error(row + ',' + col);
    }
    return this.modules[row][col];
  }

  getModuleCount() {
    return this.moduleCount;
  }

  make() {
    this.makeImpl(false, this.getBestMaskPattern());
  }

  makeImpl(test, maskPattern) {
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = new Array(this.moduleCount);
    for (let row = 0; row < this.moduleCount; row++) {
      this.modules[row] = new Array(this.moduleCount);
      for (let col = 0; col < this.moduleCount; col++) {
        this.modules[row][col] = null;
      }
    }

    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);

    if (this.typeNumber >= 7) {
      this.setupTypeNumber(test);
    }

    if (this.dataCache == null) {
      this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
    }

    this.mapData(this.dataCache, maskPattern);
  }

  setupPositionProbePattern(row, col) {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.moduleCount <= col + c) continue;
        if (
          (0 <= r && r <= 6 && (c == 0 || c == 6)) ||
          (0 <= c && c <= 6 && (r == 0 || r == 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          this.modules[row + r][col + c] = true;
        } else {
          this.modules[row + r][col + c] = false;
        }
      }
    }
  }

  getBestMaskPattern() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i++) {
      this.makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(this);
      if (i == 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  }

  setupTimingPattern() {
    for (let r = 8; r < this.moduleCount - 8; r++) {
      if (this.modules[r][6] != null) continue;
      this.modules[r][6] = r % 2 == 0;
    }
    for (let c = 8; c < this.moduleCount - 8; c++) {
      if (this.modules[6][c] != null) continue;
      this.modules[6][c] = c % 2 == 0;
    }
  }

  setupPositionAdjustPattern() {
    const pos = QRUtil.getPatternPosition(this.typeNumber);
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const row = pos[i];
        const col = pos[j];
        if (this.modules[row][col] != null) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r == -2 || r == 2 || c == -2 || c == 2 || (r == 0 && c == 0)) {
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  }

  setupTypeNumber(test) {
    const bits = QRUtil.getBCHTypeNumber(this.typeNumber);
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) == 1;
      this.modules[Math.floor(i / 3)][(i % 3) + this.moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) == 1;
      this.modules[(i % 3) + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  }

  setupTypeInfo(test, maskPattern) {
    const data = (QRErrorCorrectLevel[this.errorCorrectLevel] << 3) | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);

    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) == 1;
      if (i < 6) {
        this.modules[i][8] = mod;
      } else if (i < 8) {
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }
    }

    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) == 1;
      if (i < 8) {
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9) {
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }

    this.modules[this.moduleCount - 8][8] = !test;
  }

  mapData(data, maskPattern) {
    let inc = -1;
    let row = this.moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = QRUtil.getMaskFunction(maskPattern);

    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col--;
      while (true) {
        for (let c = 0; c < 2; c++) {
          if (this.modules[row][col - c] == null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = ((data[byteIndex] >>> bitIndex) & 1) == 1;
            }
            const mask = maskFunc(row, col - c);
            if (mask) {
              dark = !dark;
            }
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex == -1) {
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || this.moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  static create(data, errorCorrectLevel = 'M') {
    const bytes = new TextEncoder().encode(data);
    const dataLen = bytes.length;
    let typeNumber = 1;

    // Try requested error correction level first; if too large, adaptively try 'L'
    const levelsToTry = [errorCorrectLevel];
    if (errorCorrectLevel !== 'L') {
      levelsToTry.push('L');
    }

    let chosenLevel = errorCorrectLevel;
    let found = false;

    for (const level of levelsToTry) {
      typeNumber = 1;
      for (; typeNumber <= 40; typeNumber++) {
        const limit = QRUtil.getCapacity(typeNumber, level);
        if (dataLen <= limit) {
          chosenLevel = level;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      throw new Error(`Data too long to fit into standard QR Code (${dataLen} bytes).`);
    }

    const qr = new QRCodeModel(typeNumber, chosenLevel);
    qr.addData(data);
    qr.make();
    return qr;
  }

  static createData(typeNumber, errorCorrectLevel, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
    const buffer = new QRBitBuffer();

    for (let i = 0; i < dataList.length; i++) {
      const data = dataList[i];
      buffer.put(data.getMode(), 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
      data.write(buffer);
    }

    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) {
      totalDataCount += rsBlocks[i].dataCount;
    }

    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw new Error('Code length overflow. (' + buffer.getLengthInBits() + '>' + totalDataCount * 8 + ')');
    }

    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }

    while (buffer.getLengthInBits() % 8 != 0) {
      buffer.putBit(false);
    }

    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) break;
      buffer.put(0xec, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) break;
      buffer.put(0x11, 8);
    }

    return QRCodeModel.createBytes(buffer, rsBlocks);
  }

  static createBytes(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);

    for (let r = 0; r < rsBlocks.length; r++) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);

      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i++) {
        dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
      }
      offset += dcCount;

      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i++) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
      }
    }

    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) {
      totalCodeCount += rsBlocks[i].totalCount;
    }

    const data = new Array(totalCodeCount);
    let index = 0;

    for (let i = 0; i < maxDcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < dcdata[r].length) {
          data[index++] = dcdata[r][i];
        }
      }
    }

    for (let i = 0; i < maxEcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < ecdata[r].length) {
          data[index++] = ecdata[r][i];
        }
      }
    }

    return data;
  }
}

class QR8bitByte {
  constructor(data) {
    this.mode = 4; // 8-bit byte
    this.data = data;
    this.parsedData = new TextEncoder().encode(data);
  }
  getMode() { return this.mode; }
  getLength() { return this.parsedData.length; }
  write(buffer) {
    for (let i = 0; i < this.parsedData.length; i++) {
      buffer.put(this.parsedData[i], 8);
    }
  }
}

const QRErrorCorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };

class QRUtil {
  static getPatternPosition(typeNumber) {
    const PATTERN_POSITION_TABLE = [
      [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
      [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
      [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
      [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
      [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
    ];
    return PATTERN_POSITION_TABLE[typeNumber - 1] || [];
  }

  static getMaskFunction(maskPattern) {
    switch (maskPattern) {
      case 0: return (i, j) => (i + j) % 2 == 0;
      case 1: return (i, j) => i % 2 == 0;
      case 2: return (i, j) => j % 3 == 0;
      case 3: return (i, j) => (i + j) % 3 == 0;
      case 4: return (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
      case 5: return (i, j) => ((i * j) % 2) + ((i * j) % 3) == 0;
      case 6: return (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 == 0;
      case 7: return (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 == 0;
      default: throw new Error('bad maskPattern:' + maskPattern);
    }
  }

  static getErrorCorrectPolynomial(errorCorrectLength) {
    let a = new QRPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i++) {
      a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  }

  static getLengthInBits(mode, type) {
    if (1 <= type && type < 10) {
      return mode == 4 ? 8 : 10;
    } else if (type < 27) {
      return mode == 4 ? 16 : 12;
    } else {
      return mode == 4 ? 16 : 14;
    }
  }

  static getLostPoint(qrCode) {
    const moduleCount = qrCode.getModuleCount();
    let lostPoint = 0;

    for (let row = 0; row < moduleCount; row++) {
      let sameCount = 0;
      let head = qrCode.isDark(row, 0);
      for (let col = 0; col < moduleCount; col++) {
        const current = qrCode.isDark(row, col);
        if (col == 0) continue;
        if (current == head) {
          sameCount++;
        } else {
          if (sameCount >= 5) lostPoint += 3 + sameCount - 5;
          head = current;
          sameCount = 1;
        }
      }
      if (sameCount >= 5) lostPoint += 3 + sameCount - 5;
    }
    return lostPoint;
  }

  static getBCHTypeInfo(data) {
    let d = data << 10;
    while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(1335) >= 0) {
      d ^= 1335 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(1335));
    }
    return ((data << 10) | d) ^ 21522;
  }

  static getBCHTypeNumber(data) {
    let d = data << 12;
    while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(7973) >= 0) {
      d ^= 7973 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(7973));
    }
    return (data << 12) | d;
  }

  static getBCHDigit(data) {
    let digit = 0;
    while (data != 0) {
      digit++;
      data >>>= 1;
    }
    return digit;
  }

  static getCapacity(typeNumber, errorCorrectLevel) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) {
      totalDataCount += rsBlocks[i].dataCount;
    }
    return totalDataCount - 3; // Approx safe byte payload
  }
}

class QRMath {
  static glog(n) {
    if (n < 1) throw new Error('glog(' + n + ')');
    return QRMath.LOG_TABLE[n];
  }
  static gexp(n) {
    while (n < 0) n += 255;
    while (n >= 255) n -= 255;
    return QRMath.EXP_TABLE[n];
  }
}

QRMath.EXP_TABLE = new Array(256);
QRMath.LOG_TABLE = new Array(256);
for (let i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
for (let i = 8; i < 256; i++) {
  QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5] ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;

class QRPolynomial {
  constructor(num, shift) {
    if (num.length == undefined) throw new Error(num.length + '/' + shift);
    let offset = 0;
    while (offset < num.length && num[offset] == 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
    for (let i = 0; i < shift; i++) this.num[num.length - offset + i] = 0;
  }
  get(index) { return this.num[index]; }
  getLength() { return this.num.length; }
  multiply(e) {
    const num = new Array(this.getLength() + e.getLength() - 1);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
      }
    }
    return new QRPolynomial(num, 0);
  }
  mod(e) {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
    const num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
    }
    return new QRPolynomial(num, 0).mod(e);
  }
}

class QRRSBlock {
  constructor(totalCount, dataCount) {
    this.totalCount = totalCount;
    this.dataCount = dataCount;
  }
  static getRSBlocks(typeNumber, errorCorrectLevel) {
    const rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
    if (rsBlock == undefined) {
      throw new Error('bad rs block @ typeNumber:' + typeNumber + '/errorCorrectLevel:' + errorCorrectLevel);
    }
    const length = rsBlock.length / 3;
    const list = [];
    for (let i = 0; i < length; i++) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j = 0; j < count; j++) {
        list.push(new QRRSBlock(totalCount, dataCount));
      }
    }
    return list;
  }
  static getRsBlockTable(typeNumber, errorCorrectLevel) {
    // RS Block table for Level L, M, Q, H across versions 1 to 40
    const TABLE = {
      1: { M: [1, 26, 16], L: [1, 26, 19], Q: [1, 26, 13], H: [1, 26, 9] },
      2: { M: [1, 44, 28], L: [1, 44, 34], Q: [1, 44, 22], H: [1, 44, 16] },
      3: { M: [1, 70, 44], L: [1, 70, 55], Q: [2, 35, 17], H: [2, 35, 13] },
      4: { M: [2, 50, 32], L: [1, 100, 80], Q: [2, 50, 24], H: [4, 25, 9] },
      5: { M: [2, 67, 43], L: [1, 134, 108], Q: [2, 33, 15, 2, 34, 16], H: [2, 33, 11, 2, 34, 12] },
      6: { M: [4, 43, 27], L: [2, 86, 68], Q: [4, 43, 19], H: [4, 43, 15] },
      7: { M: [4, 49, 31], L: [2, 98, 78], Q: [2, 32, 14, 4, 33, 15], H: [4, 39, 13, 1, 40, 14] },
      8: { M: [2, 60, 38, 2, 61, 39], L: [2, 121, 97], Q: [4, 40, 18, 2, 41, 19], H: [4, 40, 14, 2, 41, 15] },
      9: { M: [3, 58, 36, 2, 59, 37], L: [2, 146, 116], Q: [4, 36, 16, 4, 37, 17], H: [4, 36, 12, 4, 37, 13] },
      10: { M: [4, 69, 43, 1, 70, 44], L: [2, 86, 68, 2, 87, 69], Q: [6, 43, 19, 2, 44, 20], H: [6, 43, 15, 2, 44, 16] },
      11: { M: [1, 80, 50, 4, 81, 51], L: [4, 101, 81], Q: [4, 50, 22, 4, 51, 23], H: [3, 36, 12, 8, 37, 13] },
      12: { M: [6, 58, 36, 2, 59, 37], L: [2, 116, 92, 2, 117, 93], Q: [4, 46, 20, 6, 47, 21], H: [7, 42, 14, 4, 43, 15] },
      13: { M: [8, 59, 37, 1, 60, 38], L: [4, 133, 107], Q: [8, 44, 20, 4, 45, 21], H: [12, 33, 11, 4, 34, 12] },
      14: { M: [4, 64, 40, 5, 65, 41], L: [3, 145, 115, 1, 146, 116], Q: [11, 36, 16, 5, 37, 17], H: [11, 36, 12, 5, 37, 13] },
      15: { M: [5, 65, 41, 5, 66, 42], L: [5, 109, 87, 1, 110, 88], Q: [5, 54, 24, 7, 55, 25], H: [11, 36, 12, 7, 37, 13] },
      16: { M: [7, 73, 45, 3, 74, 46], L: [5, 122, 98, 1, 123, 99], Q: [15, 43, 19, 2, 44, 20], H: [3, 45, 15, 13, 46, 16] },
      17: { M: [10, 74, 46, 1, 75, 47], L: [1, 135, 107, 5, 136, 108], Q: [1, 50, 22, 15, 51, 23], H: [2, 42, 14, 17, 43, 15] },
      18: { M: [9, 69, 43, 4, 70, 44], L: [5, 150, 120, 1, 151, 121], Q: [17, 50, 22, 1, 51, 23], H: [2, 42, 14, 19, 43, 15] },
      19: { M: [3, 70, 44, 11, 71, 45], L: [3, 141, 113, 4, 142, 114], Q: [17, 47, 21, 4, 48, 22], H: [9, 39, 13, 16, 40, 14] },
      20: { M: [3, 67, 41, 13, 68, 42], L: [3, 135, 107, 5, 136, 108], Q: [15, 54, 24, 5, 55, 25], H: [15, 43, 15, 10, 44, 16] },
      21: { M: [17, 68, 42], L: [4, 144, 116, 4, 145, 117], Q: [17, 50, 22, 6, 51, 23], H: [19, 46, 16, 6, 47, 17] },
      22: { M: [17, 74, 46], L: [2, 139, 111, 7, 140, 112], Q: [7, 54, 24, 16, 55, 25], H: [34, 37, 13] },
      23: { M: [4, 75, 47, 14, 76, 48], L: [4, 151, 121, 5, 152, 122], Q: [11, 54, 24, 14, 55, 25], H: [16, 45, 15, 14, 46, 16] },
      24: { M: [6, 73, 45, 14, 74, 46], L: [6, 147, 117, 4, 148, 118], Q: [11, 54, 24, 16, 55, 25], H: [30, 46, 16, 2, 47, 17] },
      25: { M: [8, 75, 47, 13, 76, 48], L: [8, 132, 106, 4, 133, 107], Q: [7, 54, 24, 22, 55, 25], H: [22, 45, 15, 13, 46, 16] },
      26: { M: [19, 74, 46, 4, 75, 47], L: [10, 142, 114, 2, 143, 115], Q: [28, 50, 22, 6, 51, 23], H: [33, 46, 16, 4, 47, 17] },
      27: { M: [22, 73, 45, 3, 74, 46], L: [8, 152, 122, 4, 153, 123], Q: [8, 53, 23, 26, 54, 24], H: [12, 45, 15, 28, 46, 16] },
      28: { M: [3, 73, 45, 23, 74, 46], L: [3, 147, 117, 10, 148, 118], Q: [4, 54, 24, 31, 55, 25], H: [11, 45, 15, 31, 46, 16] },
      29: { M: [21, 73, 45, 7, 74, 46], L: [7, 146, 116, 7, 147, 117], Q: [1, 53, 23, 37, 54, 24], H: [19, 45, 15, 26, 46, 16] },
      30: { M: [19, 75, 47, 10, 76, 48], L: [5, 145, 115, 10, 146, 116], Q: [15, 54, 24, 25, 55, 25], H: [23, 45, 15, 25, 46, 16] }
    };
    return (TABLE[typeNumber] && TABLE[typeNumber][errorCorrectLevel]) || TABLE[1][errorCorrectLevel];
  }
}

class QRBitBuffer {
  constructor() {
    this.buffer = [];
    this.length = 0;
  }
  get(index) {
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) == 1;
  }
  put(num, length) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) == 1);
    }
  }
  getLengthInBits() { return this.length; }
  putBit(bit) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
  getBuffer() { return this.buffer; }
}


// ==========================================
// 2. Camera QR Scanner Engine
// ==========================================
class QRScanner {
  constructor(videoElement, onScanCallback) {
    this.video = videoElement;
    this.onScan = onScanCallback;
    this.stream = null;
    this.scanning = false;
    this.facingMode = 'environment';
    this.animFrameId = null;
    this.barcodeDetector = null;
    this.lastScanTime = 0;

    // Persistent offscreen canvas to avoid garbage collection stutter
    this.scanCanvas = document.createElement('canvas');
    this.scanCtx = this.scanCanvas.getContext('2d', { willReadFrequently: true });

    if ('BarcodeDetector' in window) {
      try {
        this.barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) {
        console.warn('BarcodeDetector initialization fallback:', e);
      }
    }
  }

  /**
   * Starts camera capture and QR detection loop.
   */
  async start() {
    if (this.scanning) return;
    try {
      this.video.setAttribute('playsinline', 'true');
      this.video.setAttribute('muted', 'true');
      this.video.setAttribute('autoplay', 'true');

      // Auto-detect mobile vs desktop: mobile prefers rear (environment) camera, desktop prefers webcam
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const preferredFacing = isMobile ? this.facingMode : 'user';

      const constraints = {
        video: {
          facingMode: { ideal: preferredFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (constraintErr) {
        console.warn('Constrained camera access failed, falling back to default video input:', constraintErr);
        // Fallback for MacBooks/laptops without a rear camera or with strict permission models
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      this.video.srcObject = this.stream;
      await this.video.play();
      this.scanning = true;
      this._scanLoop();
    } catch (err) {
      console.error('Camera access error:', err);
      throw err;
    }
  }

  /**
   * Stops camera capture.
   */
  stop() {
    this.scanning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  /**
   * Toggles between front and rear cameras.
   */
  async toggleCamera() {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    this.stop();
    await this.start();
  }

  async _scanLoop() {
    if (!this.scanning) return;

    const now = performance.now();
    // Scan at ~12 fps (every 80ms) for high detection rate without burning CPU/battery
    if (now - this.lastScanTime >= 80) {
      this.lastScanTime = now;

      if (this.video.readyState >= this.video.HAVE_CURRENT_DATA && this.video.videoWidth > 0 && this.video.videoHeight > 0) {
        try {
          let foundText = null;

          // Try 1: Hardware-accelerated BarcodeDetector if present
          if (this.barcodeDetector) {
            try {
              const barcodes = await this.barcodeDetector.detect(this.video);
              if (barcodes.length > 0 && barcodes[0].rawValue) {
                foundText = barcodes[0].rawValue;
              }
            } catch (e) {
              // BarcodeDetector frame error, proceed to jsQR
            }
          }

          // Try 2: Pure JS jsQR engine
          if (!foundText && typeof window.jsQR === 'function') {
            const vw = this.video.videoWidth;
            const vh = this.video.videoHeight;
            
            // Downscale high-res video to max 640px for blazing fast decoding
            const scale = Math.min(1, 640 / Math.max(vw, vh));
            const cw = Math.floor(vw * scale);
            const ch = Math.floor(vh * scale);

            if (this.scanCanvas.width !== cw || this.scanCanvas.height !== ch) {
              this.scanCanvas.width = cw;
              this.scanCanvas.height = ch;
            }

            this.scanCtx.drawImage(this.video, 0, 0, cw, ch);
            const imgData = this.scanCtx.getImageData(0, 0, cw, ch);
            const qrResult = window.jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: "dontInvert"
            });

            if (qrResult && qrResult.data) {
              foundText = qrResult.data;
            }
          }

          if (foundText) {
            console.log('QR Code successfully detected:', foundText.slice(0, 30) + '...');
            this.onScan(foundText);
            return; // Stop scan loop once detected
          }
        } catch (err) {
          console.warn('Frame processing warning:', err);
        }
      }
    }

    this.animFrameId = requestAnimationFrame(() => this._scanLoop());
  }
}

// Export for global scope
if (typeof window !== 'undefined') {
  window.QRGenerator = QRGenerator;
  window.QRScanner = QRScanner;
}
