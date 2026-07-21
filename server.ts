import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { PDFDocument, PDFName, PDFNumber, PDFOperator, pushGraphicsState, popGraphicsState, rgb, degrees, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import * as _archiver from 'archiver';
const archiver = ((_archiver as any).default || _archiver) as any;
import sharp from 'sharp';
import qrcode from 'qrcode';

// Define static root directory relative to execution context
const rootDir = process.cwd();

// Process event listeners to catch and log rejections and exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 [FATAL] Uncaught Exception thrown in Node.js process:', err.message || err);
  if (err.stack) {
    console.error(err.stack);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 [FATAL] Unhandled Rejection at promise:', promise, 'reason:', reason);
});

interface PlacedItem {
  id: string;
  fileIndex: number;
  pageIndex: number;
  width: number;  // original mm
  height: number; // original mm
  x: number;      // mm relative to usable area (bleed box bottom-left if bleed enabled)
  y: number;      // mm relative to usable area (bleed box bottom-left if bleed enabled)
  rotated: boolean;
}

interface NestingSheet {
  placedItems: PlacedItem[];
  contentHeight: number; // mm
  croppedHeight: number; // mm
}

function calculateNesting(
  files: {
    index: number;
    name: string;
    pages: { index: number; w: number; h: number }[];
    copies: number;
  }[],
  collate: boolean,
  usableWidth: number,
  maxTableLength: number,
  forceOrientation: boolean,
  addAutoBleed: boolean,
  generateDoubleSided: boolean
): { sheets: NestingSheet[]; rotated: boolean } {
  const H_usable = maxTableLength - 50; // Subtract 50mm vertical margin

  // Build the items queue
  const queue: { fileIndex: number; pageIndex: number; w: number; h: number }[] = [];
  
  if (collate) {
    const maxCopies = Math.max(...files.map(f => f.copies), 0);
    for (let c = 0; c < maxCopies; c++) {
      for (const f of files) {
        if (c < f.copies) {
          for (const p of f.pages) {
            // In double sided mode, only nest even pages on front sheet
            if (generateDoubleSided && p.index % 2 !== 0) continue;
            queue.push({
              fileIndex: f.index,
              pageIndex: p.index,
              w: p.w,
              h: p.h
            });
          }
        }
      }
    }
  } else {
    for (const f of files) {
      for (const p of f.pages) {
        if (generateDoubleSided && p.index % 2 !== 0) continue;
        for (let c = 0; c < f.copies; c++) {
          queue.push({
            fileIndex: f.index,
            pageIndex: p.index,
            w: p.w,
            h: p.h
          });
        }
      }
    }
  }

  // Pack items using shelf-packing algorithm
  const pack = (rotate90: boolean) => {
    const sheets: NestingSheet[] = [];
    let currentSheet: NestingSheet = { placedItems: [], contentHeight: 0, croppedHeight: 50 };

    let currentX = 0;
    let currentY = 0;
    let currentRowHeight = 0;

    for (let i = 0; i < queue.length; i++) {
      const qItem = queue[i];
      // If bleed is active, the packing dimensions are increased by 6mm (3mm bleed on all sides)
      const w = rotate90 
        ? (qItem.h + (addAutoBleed ? 6 : 0)) 
        : (qItem.w + (addAutoBleed ? 6 : 0));
      const h = rotate90 
        ? (qItem.w + (addAutoBleed ? 6 : 0)) 
        : (qItem.h + (addAutoBleed ? 6 : 0));

      // Distance check for first item vs subsequent items in row (6mm gap)
      const neededXSpace = currentX === 0 ? w : w + 6;

      if (currentX + neededXSpace <= usableWidth) {
        // Fits on current row
        const posX = currentX === 0 ? 0 : currentX + 6;
        currentSheet.placedItems.push({
          id: `item-${i}`,
          fileIndex: qItem.fileIndex,
          pageIndex: qItem.pageIndex,
          width: qItem.w,
          height: qItem.h,
          x: posX,
          y: currentY,
          rotated: rotate90
        });
        currentX = posX + w;
        currentRowHeight = Math.max(currentRowHeight, h);
      } else {
        // Start a new row
        const nextY = currentY + currentRowHeight + 6;

        if (nextY + h <= H_usable) {
          // Fits on current sheet
          currentY = nextY;
          currentX = w;
          currentRowHeight = h;
          currentSheet.placedItems.push({
            id: `item-${i}`,
            fileIndex: qItem.fileIndex,
            pageIndex: qItem.pageIndex,
            width: qItem.w,
            height: qItem.h,
            x: 0,
            y: currentY,
            rotated: rotate90
          });
        } else {
          // New sheet
          if (currentSheet.placedItems.length > 0) {
            const maxH = Math.max(...currentSheet.placedItems.map(item => {
              const itemH = (item.rotated ? item.width : item.height) + (addAutoBleed ? 6 : 0);
              return item.y + itemH;
            }));
            currentSheet.contentHeight = maxH;
            currentSheet.croppedHeight = maxH + 50;
            sheets.push(currentSheet);
          }

          // Reset sheet coordinates
          currentSheet = { placedItems: [], contentHeight: 0, croppedHeight: 50 };
          currentX = w;
          currentY = 0;
          currentRowHeight = h;
          currentSheet.placedItems.push({
            id: `item-${i}`,
            fileIndex: qItem.fileIndex,
            pageIndex: qItem.pageIndex,
            width: qItem.w,
            height: qItem.h,
            x: 0,
            y: 0,
            rotated: rotate90
          });
        }
      }
    }

    // Push trailing sheet
    if (currentSheet.placedItems.length > 0) {
      const maxH = Math.max(...currentSheet.placedItems.map(item => {
        const itemH = (item.rotated ? item.width : item.height) + (addAutoBleed ? 6 : 0);
        return item.y + itemH;
      }));
      currentSheet.contentHeight = maxH;
      currentSheet.croppedHeight = maxH + 50;
      sheets.push(currentSheet);
    }

    return sheets;
  };

  const sheetsPortrait = pack(false);
  if (forceOrientation) {
    return { sheets: sheetsPortrait, rotated: false };
  }

  const sheetsLandscape = pack(true);
  
  // Calculate total material heights
  const totalHPortrait = sheetsPortrait.reduce((sum, s) => sum + s.croppedHeight, 0);
  const totalHLandscape = sheetsLandscape.reduce((sum, s) => sum + s.croppedHeight, 0);

  if (totalHLandscape < totalHPortrait) {
    return { sheets: sheetsLandscape, rotated: true };
  } else {
    return { sheets: sheetsPortrait, rotated: false };
  }
}

function areSheetsIdentical(sheetA: NestingSheet, sheetB: NestingSheet): boolean {
  if (sheetA.croppedHeight !== sheetB.croppedHeight) return false;
  if (sheetA.placedItems.length !== sheetB.placedItems.length) return false;

  for (let i = 0; i < sheetA.placedItems.length; i++) {
    const itemA = sheetA.placedItems[i];
    const itemB = sheetB.placedItems[i];

    if (itemA.fileIndex !== itemB.fileIndex) return false;
    if (itemA.pageIndex !== itemB.pageIndex) return false;
    if (Math.abs(itemA.width - itemB.width) > 0.01) return false;
    if (Math.abs(itemA.height - itemB.height) > 0.01) return false;
    if (Math.abs(itemA.x - itemB.x) > 0.01) return false;
    if (Math.abs(itemA.y - itemB.y) > 0.01) return false;
    if (itemA.rotated !== itemB.rotated) return false;
  }

  return true;
}

function formatIndices(indices: number[]): string {
  if (indices.length === 0) return '';
  if (indices.length === 1) return `${indices[0] + 1}`;
  
  // Check if consecutive
  let consecutive = true;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) {
      consecutive = false;
      break;
    }
  }
  if (consecutive) {
    return `${indices[0] + 1}-${indices[indices.length - 1] + 1}`;
  }
  return indices.map(idx => idx + 1).join(', ');
}

async function startServer() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // API Route: Basic Preflight File Inspection
  app.post('/api/preflight', async (req, res) => {
    try {
      const { base64, mimeType, name } = req.body;
      if (!base64 || base64.trim() === '') {
        return res.status(400).json({ error: 'File buffer is missing or empty' });
      }

      const rawBuffer = Buffer.from(base64, 'base64');
      if (rawBuffer.length === 0) {
        return res.status(400).json({ error: 'Decoded file buffer is empty' });
      }

      const isImage = mimeType && mimeType.startsWith('image/');
      let dpi = 300;
      let colorSpace = 'Unknown';
      let warnings: string[] = [];
      let info: string[] = [];

      if (isImage) {
        try {
          const metadata = await sharp(rawBuffer).metadata();
          colorSpace = (metadata.space || 'RGB').toUpperCase();
          
          let detectedDpi = 72;
          if (metadata.density) {
            if (metadata.resolutionUnit === 'cm') {
              detectedDpi = Math.round(metadata.density * 2.54);
            } else {
              detectedDpi = metadata.density;
            }
          } else {
            detectedDpi = 150; // standard fallback
          }
          dpi = detectedDpi;

          if (colorSpace === 'SRGB' || colorSpace === 'RGB') {
            warnings.push('RGB Color Space detected. Prepress standard requires CMYK.');
          }
          if (dpi < 72) {
            warnings.push(`Low Resolution warning: ${dpi} DPI detected (Prepress standard is >= 150 DPI).`);
          }
        } catch (sharpErr: any) {
          warnings.push(`Failed to parse image metadata: ${sharpErr.message}`);
        }
      } else {
        // PDF Preflight
        try {
          colorSpace = 'CMYK (Presumed)';
          const pdfString = rawBuffer.toString('latin1');
          
          const hasRGB = pdfString.includes('/DeviceRGB') || pdfString.includes('DeviceRGB');
          const hasCMYK = pdfString.includes('/DeviceCMYK') || pdfString.includes('DeviceCMYK');
          
          if (hasRGB) {
            colorSpace = 'RGB';
            warnings.push('PDF contains RGB elements. Prepress standard requires CMYK.');
          } else if (hasCMYK) {
            colorSpace = 'CMYK';
          }
          
          info.push('Vector PDF detected (infinite resolution).');
        } catch (pdfErr: any) {
          warnings.push(`Failed to analyze PDF structure: ${pdfErr.message}`);
        }
      }

      return res.json({
        success: true,
        dpi,
        colorSpace,
        warnings,
        info
      });
    } catch (err: any) {
      console.error('Preflight error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // API Route for PDF imposition generation
  app.post('/api/generate', async (req, res) => {
    try {
      let {
        files,
        jobName = 'Imposition Job',
        collate = false,
        materialWidth = 1370,
        customWidth = false,
        tableLength = 2500,
        forceOrientation = false,
        hasNativeCutContour = false,
        addAutoBleed = false,
        addZundQRCode = false,
        generateDoubleSided = false,
        cornerRadius = 0
      } = req.body;

      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files provided for layout generation. File buffer is missing or empty.' });
      }

      // Sanitize inputs
      const safeJobName = (jobName || 'Imposition Job').toString();
      const cleanJobName = safeJobName.replace(/[^a-zA-Z0-9_\-]/g, "_");
      
      const safeMaterialWidth = Number(materialWidth) || 1370;
      const safeTableLength = Number(tableLength) || 2500;
      const safeCornerRadius = Number(cornerRadius) || 0;
      const isCustomWidth = customWidth === true;
      const isForceOrientation = forceOrientation === true;

      const mmToPoints = 72 / 25.4;
      const usableWidth = isCustomWidth ? safeMaterialWidth : safeMaterialWidth - 20;

      // 1. Load and process all documents
      const loadedDocs = await Promise.all(
        files.map(async (file: any, fIdx: number) => {
          if (!file.base64 || file.base64.trim() === '') {
            throw new Error(`File buffer (base64 content) is missing or empty for file "${file.name || fIdx}".`);
          }

          let srcDocPrint: PDFDocument;
          let srcDocCut: PDFDocument;
          const isImage = file.mimeType && file.mimeType.startsWith('image/');
          
          const origWidth = Number(file.originalWidth) || 100;
          const origHeight = Number(file.originalHeight) || 100;

          if (isImage) {
            const rawBuffer = Buffer.from(file.base64, 'base64');
            if (rawBuffer.length === 0) {
              throw new Error(`Decoded file buffer is empty for file "${file.name || fIdx}".`);
            }

            // Create Cut PDF (original size, no bleed)
            srcDocCut = await PDFDocument.create();
            const pageCut = srcDocCut.addPage([origWidth * mmToPoints, origHeight * mmToPoints]);
            let embeddedImgCut;
            
            // Embed original image
            const isPng = rawBuffer.length >= 4 && rawBuffer[0] === 0x89 && rawBuffer[1] === 0x50 && rawBuffer[2] === 0x4E && rawBuffer[3] === 0x47;
            if (isPng || file.mimeType === 'image/png' || file.name?.toLowerCase().endsWith('.png')) {
              try { embeddedImgCut = await srcDocCut.embedPng(rawBuffer); } 
              catch { embeddedImgCut = await srcDocCut.embedJpg(rawBuffer); }
            } else {
              try { embeddedImgCut = await srcDocCut.embedJpg(rawBuffer); } 
              catch { embeddedImgCut = await srcDocCut.embedPng(rawBuffer); }
            }
            pageCut.drawImage(embeddedImgCut, {
              x: 0, y: 0, width: origWidth * mmToPoints, height: origHeight * mmToPoints
            });

            // Create Print PDF (with mirrored 3mm bleed if checked)
            srcDocPrint = await PDFDocument.create();
            let finalPrintBuffer = rawBuffer;

            if (addAutoBleed) {
              try {
                const metadata = await sharp(rawBuffer).metadata();
                const pxPerMmX = (metadata.width || 1) / origWidth;
                const pxPerMmY = (metadata.height || 1) / origHeight;
                const bleedPxX = Math.round(3 * pxPerMmX);
                const bleedPxY = Math.round(3 * pxPerMmY);
                finalPrintBuffer = await sharp(rawBuffer)
                  .extend({
                    top: bleedPxY, bottom: bleedPxY, left: bleedPxX, right: bleedPxX,
                    extendWith: 'mirror'
                  })
                  .toBuffer();
              } catch (sharpErr) {
                console.error(`Bleed sharp process failed for ${file.name}:`, sharpErr);
              }
            }

            const bleedWidth = origWidth + (addAutoBleed ? 6 : 0);
            const bleedHeight = origHeight + (addAutoBleed ? 6 : 0);
            const pagePrint = srcDocPrint.addPage([bleedWidth * mmToPoints, bleedHeight * mmToPoints]);
            
            let embeddedImgPrint;
            if (isPng || file.mimeType === 'image/png' || file.name?.toLowerCase().endsWith('.png')) {
              try { embeddedImgPrint = await srcDocPrint.embedPng(finalPrintBuffer); } 
              catch { embeddedImgPrint = await srcDocPrint.embedJpg(finalPrintBuffer); }
            } else {
              try { embeddedImgPrint = await srcDocPrint.embedJpg(finalPrintBuffer); } 
              catch { embeddedImgPrint = await srcDocPrint.embedPng(finalPrintBuffer); }
            }
            pagePrint.drawImage(embeddedImgPrint, {
              x: 0, y: 0, width: bleedWidth * mmToPoints, height: bleedHeight * mmToPoints
            });

          } else {
            // PDF file
            const doc = await PDFDocument.load(Buffer.from(file.base64, 'base64'), { ignoreEncryption: true });
            srcDocPrint = doc;
            srcDocCut = doc;
          }

          // Prevent MissingPageContentsEmbeddingError by ensuring every page has a Contents stream
          const cleanContentsStream = (docObj: PDFDocument) => {
            const pages = docObj.getPages();
            for (const p of pages) {
              if (!p.node.get(PDFName.of('Contents'))) {
                p.drawText('', { size: 0 });
              }
            }
          };
          cleanContentsStream(srcDocPrint);
          cleanContentsStream(srcDocCut);

          const srcPages = srcDocPrint.getPages();
          const pageSpecs = (file.pages && Array.isArray(file.pages) && file.pages.length > 0)
            ? file.pages.map((p: any) => ({
                index: Number(p.index),
                w: Number(p.w) || origWidth,
                h: Number(p.h) || origHeight
              }))
            : srcPages.map((page, idx) => {
                const { width, height } = page.getSize();
                return {
                  index: idx,
                  w: Math.round(width * (25.4 / 72)),
                  h: Math.round(height * (25.4 / 72))
                };
              });

          return {
            index: fIdx,
            name: file.name || `artwork_${fIdx}`,
            printDoc: srcDocPrint,
            cutDoc: srcDocCut,
            pages: pageSpecs,
            copies: Number(file.copies || 1)
          };
        })
      );

      // 2. Perform Nesting Layout math
      const { sheets, rotated } = calculateNesting(
        loadedDocs,
        collate === true,
        usableWidth,
        safeTableLength,
        isForceOrientation,
        addAutoBleed,
        generateDoubleSided
      );

      // Group identical sheets to prevent duplicates and reduce RIP time
      interface SheetGroup {
        uniqueSheet: NestingSheet;
        count: number;
        originalIndices: number[];
      }

      const groups: SheetGroup[] = [];

      for (let i = 0; i < sheets.length; i++) {
        const currentSheet = sheets[i];
        let foundGroup = false;

        for (const group of groups) {
          if (areSheetsIdentical(group.uniqueSheet, currentSheet)) {
            group.count++;
            group.originalIndices.push(i);
            foundGroup = true;
            break;
          }
        }

        if (!foundGroup) {
          groups.push({
            uniqueSheet: currentSheet,
            count: 1,
            originalIndices: [i]
          });
        }
      }

      // Create ZIP container
      const archive = archiver('zip', { zlib: { level: 9 } });

      // Helper function to draw registration dots
      const drawRegistrationDots = (page: any, wMm: number, hMm: number, isBack: boolean = false) => {
        const dotRadiusMm = 2.5;
        const dotSize = dotRadiusMm * mmToPoints;

        const drawDot = (xMm: number, yMm: number) => {
          page.drawCircle({
            x: xMm * mmToPoints,
            y: yMm * mmToPoints,
            size: dotSize,
            color: rgb(0, 0, 0),
          });
        };

        const leftX = 5.0;
        const rightX = wMm - 5.0;
        const bottomY = 5.0;
        const topY = hMm - 5.0;

        // Draw 4 Corner Dots
        drawDot(leftX, bottomY);
        drawDot(rightX, bottomY);
        drawDot(leftX, topY);
        drawDot(rightX, topY);

        // Draw 5th Orientation Dot
        const orientationY = 5.0;
        const orientationX = isBack ? 32.5 : wMm - 32.5; // Horizontal mirror for Back sheet
        drawDot(orientationX, orientationY);

        // Draw Intermediate side dots (every 800 mm if sheet length is greater than 800 mm)
        if (hMm > 800) {
          let currentY = topY - 800;
          while (currentY > bottomY + 20) {
            drawDot(leftX, currentY);
            drawDot(rightX, currentY);
            currentY -= 800;
          }
        }
      };

      // Generate Zünd QR Code buffer if true
      let qrImageBytes: Buffer | null = null;
      if (addZundQRCode) {
        try {
          qrImageBytes = await qrcode.toBuffer(cleanJobName, {
            margin: 1,
            width: 120,
            errorCorrectionLevel: 'M'
          });
        } catch (qrErr) {
          console.error("QR Code generation failed:", qrErr);
        }
      }

      // 3. Generate Print and Zünd sheets
      for (let gIdx = 0; gIdx < groups.length; gIdx++) {
        const group = groups[gIdx];
        const sheet = group.uniqueSheet;
        const sIdx = group.originalIndices[0]; // Use first original sheet index for any layout calculations
        const sheetWidthPoints = safeMaterialWidth * mmToPoints;
        const sheetHeightPoints = sheet.croppedHeight * mmToPoints;

        const filenamePrefix = groups.length === 1
          ? cleanJobName
          : `${cleanJobName}_Sheet_${gIdx + 1}`;

        // Compute horizontal offset to perfectly center the nested items on the sheet width
        const maxRightEdge = sheet.placedItems.length > 0 
          ? Math.max(...sheet.placedItems.map(item => {
              const itemW = (item.rotated ? item.height : item.width) + (addAutoBleed ? 6 : 0);
              return item.x + itemW;
            }))
          : 0;
        const hOffset = (safeMaterialWidth - maxRightEdge) / 2;

        // ==========================================
        // FRONT PRINT PDF
        // ==========================================
        const printDoc = await PDFDocument.create();
        const printPage = printDoc.addPage([sheetWidthPoints, sheetHeightPoints]);
        const helveticaFont = await printDoc.embedFont(StandardFonts.Helvetica);

        // Copy and embed artwork pages
        for (let i = 0; i < sheet.placedItems.length; i++) {
          const item = sheet.placedItems[i];
          const sourceObj = loadedDocs[item.fileIndex];

          const pageCount = sourceObj.printDoc.getPageCount();
          const pageIdxToCopy = Math.max(0, Math.min(item.pageIndex, pageCount - 1));
          
          const [copiedPage] = await printDoc.copyPages(sourceObj.printDoc, [pageIdxToCopy]);
          const emb = await printDoc.embedPage(copiedPage);

          // If bleed is active, the printed box size is increased by 6mm (3mm on all sides)
          const wPoints = (item.width + (addAutoBleed ? 6 : 0)) * mmToPoints;
          const hPoints = (item.height + (addAutoBleed ? 6 : 0)) * mmToPoints;

          const xPos = (item.x + hOffset) * mmToPoints;
          const yPos = (item.y + 25) * mmToPoints;

          if (item.rotated) {
            printPage.drawPage(emb, {
              x: xPos + hPoints,
              y: yPos,
              width: wPoints,
              height: hPoints,
              rotate: degrees(90)
            });
          } else {
            printPage.drawPage(emb, {
              x: xPos,
              y: yPos,
              width: wPoints,
              height: hPoints,
            });
          }
        }

        // Draw registration marks on Front Print Sheet
        drawRegistrationDots(printPage, safeMaterialWidth, sheet.croppedHeight, false);

        // Draw Text Label on Print Sheet
        const labelText = sheets.length === 1
          ? `${safeJobName} | Print 1x`
          : `${safeJobName} | Sheets ${formatIndices(group.originalIndices)} of ${sheets.length} (Print ${group.count}x)`;
        printPage.drawText(labelText, {
          x: 50 * mmToPoints,
          y: 12 * mmToPoints,
          size: 10,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });

        // Embed QR Code on Front Print Sheet in bottom margin
        if (addZundQRCode && qrImageBytes) {
          const qrEmb = await printDoc.embedPng(qrImageBytes);
          const qrSizePoints = 15 * mmToPoints; // 15mm x 15mm
          const qrX = (safeMaterialWidth - 65) * mmToPoints;
          const qrY = 5 * mmToPoints;
          printPage.drawImage(qrEmb, {
            x: qrX, y: qrY, width: qrSizePoints, height: qrSizePoints
          });
        }

        const printPdfBytes = await printDoc.save();
        archive.append(Buffer.from(printPdfBytes), { name: `${filenamePrefix}_Print_${group.count}x.pdf` });

        // ==========================================
        // DOUBLE-SIDED BACK PRINT PDF
        // ==========================================
        if (generateDoubleSided) {
          const backDoc = await PDFDocument.create();
          const backPage = backDoc.addPage([sheetWidthPoints, sheetHeightPoints]);
          const backHelvetica = await backDoc.embedFont(StandardFonts.Helvetica);

          // Copy and embed mirrored artwork pages
          for (let i = 0; i < sheet.placedItems.length; i++) {
            const item = sheet.placedItems[i];
            const sourceObj = loadedDocs[item.fileIndex];

            const pageCount = sourceObj.printDoc.getPageCount();
            
            // Front-Back page index pairing: if front is page P, back is P + 1 (if available), else P
            let backPageIdx = item.pageIndex;
            if (item.pageIndex % 2 === 0 && pageCount > item.pageIndex + 1) {
              backPageIdx = item.pageIndex + 1;
            }
            backPageIdx = Math.max(0, Math.min(backPageIdx, pageCount - 1));

            const [copiedPage] = await backDoc.copyPages(sourceObj.printDoc, [backPageIdx]);
            const emb = await backDoc.embedPage(copiedPage);

            const wPoints = (item.width + (addAutoBleed ? 6 : 0)) * mmToPoints;
            const hPoints = (item.height + (addAutoBleed ? 6 : 0)) * mmToPoints;

            // HORIZONTAL MIRROR CALCULATION RELATIVE TO SHEET WIDTH
            const itemVisualWidthMm = (item.rotated ? item.height : item.width) + (addAutoBleed ? 6 : 0);
            const xFrontMm = item.x + hOffset;
            const xBackMm = safeMaterialWidth - itemVisualWidthMm - xFrontMm;

            const xPosBack = xBackMm * mmToPoints;
            const yPos = (item.y + 25) * mmToPoints; // vertical coordinates remain identical

            if (item.rotated) {
              backPage.drawPage(emb, {
                x: xPosBack + hPoints,
                y: yPos,
                width: wPoints,
                height: hPoints,
                rotate: degrees(90)
              });
            } else {
              backPage.drawPage(emb, {
                x: xPosBack,
                y: yPos,
                width: wPoints,
                height: hPoints,
              });
            }
          }

          // Draw horizontally flipped registration dots for Back Sheet (isBack = true)
          drawRegistrationDots(backPage, safeMaterialWidth, sheet.croppedHeight, true);

          // Draw Text Label on Back Sheet
          const backLabelText = sheets.length === 1
            ? `${safeJobName} | Print 1x | BACK`
            : `${safeJobName} | Sheets ${formatIndices(group.originalIndices)} of ${sheets.length} (Print ${group.count}x) | BACK`;
          backPage.drawText(backLabelText, {
            x: (safeMaterialWidth - 150) * mmToPoints, // horizontally offset to align when flipped
            y: 12 * mmToPoints,
            size: 10,
            font: backHelvetica,
            color: rgb(0, 0, 0),
          });

          // Embed mirrored QR Code on Back Sheet
          if (addZundQRCode && qrImageBytes) {
            const qrEmb = await backDoc.embedPng(qrImageBytes);
            const qrSizePoints = 15 * mmToPoints;
            const qrX = 50 * mmToPoints; // Flipped position: 50mm from left instead of 65mm from right
            const qrY = 5 * mmToPoints;
            backPage.drawImage(qrEmb, {
              x: qrX, y: qrY, width: qrSizePoints, height: qrSizePoints
            });
          }

          const backPdfBytes = await backDoc.save();
          archive.append(Buffer.from(backPdfBytes), { name: `${filenamePrefix}_Back_Print_${group.count}x.pdf` });
        }

        // ==========================================
        // ZÜND CUT PDF
        // ==========================================
        const zundDoc = await PDFDocument.create();
        const zundPage = zundDoc.addPage([sheetWidthPoints, sheetHeightPoints]);

        // Define Separation Color Space for CutContour Spot Color (CMYK 0, 100, 0, 0)
        const separationCS = zundDoc.context.obj([
          'Separation',
          'CutContour',
          'DeviceCMYK',
          {
            FunctionType: 2,
            Domain: [0, 1],
            C0: [0, 0, 0, 0],
            C1: [0, 1, 0, 0],
            N: 1
          }
        ]);
        const colorSpaceRef = zundDoc.context.register(separationCS);
        
        let resources = (zundPage.node as any).Resources();
        if (!resources) {
          resources = zundDoc.context.obj({});
          (zundPage.node as any).set(PDFName.of('Resources'), resources);
        }

        let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
        if (colorSpaceDict) {
          colorSpaceDict = zundDoc.context.lookup(colorSpaceDict);
        } else {
          colorSpaceDict = zundDoc.context.obj({});
          resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
        }

        colorSpaceDict.set(PDFName.of('CS_CutContour'), colorSpaceRef);

        // Draw registration marks on Zünd Sheet
        drawRegistrationDots(zundPage, safeMaterialWidth, sheet.croppedHeight, false);

        // Draw vector cut lines (bounding boxes) or embed native CutContour artwork
        for (let i = 0; i < sheet.placedItems.length; i++) {
          const item = sheet.placedItems[i];
          const sourceObj = loadedDocs[item.fileIndex];

          const xPos = (item.x + hOffset) * mmToPoints;
          const yPos = (item.y + 25) * mmToPoints;

          // If bleed is enabled, the cut path/contour must be offset by 3mm inside the bleed box
          const offsetPoints = (addAutoBleed ? 3 : 0) * mmToPoints;
          const xPosCent = xPos + offsetPoints;
          const yPosCent = yPos + offsetPoints;

          if (hasNativeCutContour) {
            const pageCount = sourceObj.cutDoc.getPageCount();
            const pageIdxToCopy = Math.max(0, Math.min(item.pageIndex, pageCount - 1));

            const [copiedPage] = await zundDoc.copyPages(sourceObj.cutDoc, [pageIdxToCopy]);
            const emb = await zundDoc.embedPage(copiedPage);

            const wPoints = item.width * mmToPoints;
            const hPoints = item.height * mmToPoints;

            if (item.rotated) {
              zundPage.drawPage(emb, {
                x: xPosCent + hPoints,
                y: yPosCent,
                width: wPoints,
                height: hPoints,
                rotate: degrees(90)
              });
            } else {
              zundPage.drawPage(emb, {
                x: xPosCent,
                y: yPosCent,
                width: wPoints,
                height: hPoints,
              });
            }
          } else {
            // Draw custom Spot-Color bounding shape for cutting table
            const wBox = (item.rotated ? item.height : item.width) * mmToPoints;
            const hBox = (item.rotated ? item.width : item.height) * mmToPoints;

            if (safeCornerRadius > 0) {
              const requestedRadiusPoints = safeCornerRadius * mmToPoints;
              const maxR = Math.min(wBox / 2, hBox / 2);
              const r = Math.min(requestedRadiusPoints, maxR);

              // Generate manual SVG path string for rounded rectangle
              // Start top-left and trace clockwise
              const svgPath = `M ${r} 0 L ${wBox - r} 0 A ${r} ${r} 0 0 1 ${wBox} ${r} L ${wBox} ${hBox - r} A ${r} ${r} 0 0 1 ${wBox - r} ${hBox} L ${r} ${hBox} A ${r} ${r} 0 0 1 0 ${hBox - r} L 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;

              // Measure index of the first operator of our drawSvgPath operation
              const startIndex = (zundPage as any).getContentStream().operators.length;

              zundPage.drawSvgPath(svgPath, {
                x: xPosCent,
                y: yPosCent + hBox,
                borderWidth: 0.5,
                borderColor: rgb(1, 0, 1) // Pink dummy color
              });

              // Post-process the appended operators of this drawSvgPath call to use Spot Color CutContour
              const operators = (zundPage as any).getContentStream().operators;
              for (let opIdx = startIndex; opIdx < operators.length; opIdx++) {
                const op = operators[opIdx];
                if (op.name === 'RG') { // Set stroking color operator
                  // Replace RGB stroking color operator with separation color space
                  const csOp = PDFOperator.of('CS' as any, [PDFName.of('CS_CutContour')]);
                  const scnOp = PDFOperator.of('SCN' as any, [PDFNumber.of(1.0)]);
                  
                  operators.splice(opIdx, 1, csOp, scnOp);
                  opIdx++; // adjust for the added operator
                }
              }
            } else {
              // Draw sharp box
              zundPage.pushOperators(
                pushGraphicsState(),
                PDFOperator.of('CS' as any, [PDFName.of('CS_CutContour')]),
                PDFOperator.of('SCN' as any, [PDFNumber.of(1.0)]),
                PDFOperator.of('w' as any, [PDFNumber.of(0.5)]),
                PDFOperator.of('re' as any, [
                  PDFNumber.of(xPosCent),
                  PDFNumber.of(yPosCent),
                  PDFNumber.of(wBox),
                  PDFNumber.of(hBox)
                ]),
                PDFOperator.of('S' as any, []),
                popGraphicsState()
              );
            }
          }
        }

        const zundPdfBytes = await zundDoc.save();
        archive.append(Buffer.from(zundPdfBytes), { name: `${filenamePrefix}_Zund_${group.count}x.pdf` });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanJobName}_Production_Files.zip"`);

      archive.on('error', (err: any) => {
        console.error("💥 [FATAL ZIP STREAM ERROR]:", err.message || err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: "Stream error occurred while generating ZIP.",
            details: err.message || err
          });
        }
      });

      archive.pipe(res);
      await archive.finalize();
      return;

    } catch (err: any) {
      console.error("Error during PDF imposition generation:", err.message || err);
      return res.status(500).json({ 
        success: false,
        error: err.message || err, 
        details: err.stack 
      });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(rootDir, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.resolve(rootDir, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[Imposition Server] Running at http://localhost:${port}`);
  });
}

startServer();
