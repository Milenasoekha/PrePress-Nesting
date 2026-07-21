import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Upload, FileText, CheckCircle2, Settings2, AlertCircle, 
  Trash2, Download, RefreshCw, Layers, Eye, Scissors, 
  ChevronLeft, ChevronRight, Info, HelpCircle, AlertTriangle, 
  FileImage, Save, ArrowLeftRight, Check, Sparkles, QrCode,
  FolderOpen
} from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

interface PlacedItem {
  id: string;
  fileIndex: number;
  pageIndex: number;
  width: number;  // original mm
  height: number; // original mm
  x: number;      // mm relative to usable area
  y: number;      // mm relative to usable area
  rotated: boolean;
}

interface NestingSheet {
  placedItems: PlacedItem[];
  contentHeight: number; // mm
  croppedHeight: number; // mm
}

interface PageSpec {
  index: number;
  w: number;
  h: number;
  detectedW?: number;
  detectedH?: number;
}

interface PreflightInfo {
  dpi: number;
  colorSpace: string;
  warnings: string[];
  info: string[];
}

interface UploadedFile {
  id: string;
  name: string;
  base64: string;
  mimeType: string;
  size: number;
  detectedWidth: number;
  detectedHeight: number;
  originalWidth: number;
  originalHeight: number;
  pageCount: number;
  pdfPagesSpecs: PageSpec[];
  copies: number;
  imagePreviewUrl?: string | null;
  scale?: number;
  preflight?: PreflightInfo;
  showWarningsPopover?: boolean;
}

const FILE_COLORS = [
  { hex: '#6366f1', textClass: 'text-indigo-600', bgClass: 'bg-indigo-50/70', borderClass: 'border-indigo-400', badgeClass: 'bg-indigo-100 text-indigo-800' }, 
  { hex: '#10b981', textClass: 'text-emerald-600', bgClass: 'bg-emerald-50/70', borderClass: 'border-emerald-400', badgeClass: 'bg-emerald-100 text-emerald-800' }, 
  { hex: '#f59e0b', textClass: 'text-amber-600', bgClass: 'bg-amber-50/70', borderClass: 'border-amber-400', badgeClass: 'bg-amber-100 text-amber-800' }, 
  { hex: '#ef4444', textClass: 'text-red-600', bgClass: 'bg-red-50/70', borderClass: 'border-red-400', badgeClass: 'bg-red-100 text-red-800' }, 
  { hex: '#06b6d4', textClass: 'text-cyan-600', bgClass: 'bg-cyan-50/70', borderClass: 'border-cyan-400', badgeClass: 'bg-cyan-100 text-cyan-800' }, 
  { hex: '#d946ef', textClass: 'text-fuchsia-600', bgClass: 'bg-fuchsia-50/70', borderClass: 'border-fuchsia-400', badgeClass: 'bg-fuchsia-100 text-fuchsia-800' }, 
  { hex: '#14b8a6', textClass: 'text-teal-600', bgClass: 'bg-teal-50/70', borderClass: 'border-teal-400', badgeClass: 'bg-teal-100 text-teal-800' }, 
  { hex: '#8b5cf6', textClass: 'text-violet-600', bgClass: 'bg-violet-50/70', borderClass: 'border-violet-400', badgeClass: 'bg-violet-100 text-violet-800' }, 
  { hex: '#f97316', textClass: 'text-orange-600', bgClass: 'bg-orange-50/70', borderClass: 'border-orange-400', badgeClass: 'bg-orange-100 text-orange-800' }, 
];

const DEFAULT_PRESETS = [
  {
    id: 'preset-standard',
    name: 'Standard Roll Banner (1370mm)',
    settings: {
      widthType: 'standard' as const,
      standardWidth: 1370,
      customWidthVal: 1000,
      tableLength: 2500,
      collate: false,
      forceOrientation: false,
      hasNativeCutContour: false,
      addAutoBleed: false,
      addZundQRCode: false,
      generateDoubleSided: false
    }
  },
  {
    id: 'preset-textile',
    name: 'Textile Auto-Bleed Roll (1600mm)',
    settings: {
      widthType: 'standard' as const,
      standardWidth: 1600,
      customWidthVal: 1000,
      tableLength: 3200,
      collate: false,
      forceOrientation: false,
      hasNativeCutContour: false,
      addAutoBleed: true,
      addZundQRCode: true,
      generateDoubleSided: false
    }
  },
  {
    id: 'preset-double-sided',
    name: 'Double-Sided Rigid Board (1000mm)',
    settings: {
      widthType: 'custom' as const,
      standardWidth: 1370,
      customWidthVal: 1000,
      tableLength: 1600,
      collate: true,
      forceOrientation: true,
      hasNativeCutContour: true,
      addAutoBleed: true,
      addZundQRCode: true,
      generateDoubleSided: true
    }
  }
];

export default function App() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [isParsing, setIsParsing] = useState<boolean>(false);

  // Hotfolder Directory Handles for File System Access API
  const [ripDirHandle, setRipDirHandle] = useState<any | null>(null);
  const [zundDirHandle, setZundDirHandle] = useState<any | null>(null);
  const [isHotfolderRoutingEnabled, setIsHotfolderRoutingEnabled] = useState<boolean>(false);

  const handleSelectRipHotfolder = async () => {
    try {
      if (typeof (window as any).showDirectoryPicker !== 'function') {
        showAlert("Your browser doesn't support the File System Access API. Please use Google Chrome, Microsoft Edge, or another modern Chromium-based browser.", "Not Supported");
        return;
      }
      if (window.self !== window.top) {
        showAlert("Due to browser security policies, local hotfolders cannot be selected while running inside an iframe. Please click the 'Open in New Tab' button in the top bar of AI Studio to grant permissions and use Hotfolder Routing.", "Open in New Tab Required");
        return;
      }
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      setRipDirHandle(handle);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(err);
        if (err.message && err.message.includes("sub frames")) {
          showAlert("Security Restriction: Browsers block local file picker requests from inside an iframe. Please open this app in a new window/tab to select your Hotfolder.", "Open in New Tab Required");
        } else {
          showAlert(`Failed to select directory: ${err.message}`, "Error");
        }
      }
    }
  };

  const handleSelectZundHotfolder = async () => {
    try {
      if (typeof (window as any).showDirectoryPicker !== 'function') {
        showAlert("Your browser doesn't support the File System Access API. Please use Google Chrome, Microsoft Edge, or another modern Chromium-based browser.", "Not Supported");
        return;
      }
      if (window.self !== window.top) {
        showAlert("Due to browser security policies, local hotfolders cannot be selected while running inside an iframe. Please click the 'Open in New Tab' button in the top bar of AI Studio to grant permissions and use Hotfolder Routing.", "Open in New Tab Required");
        return;
      }
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      setZundDirHandle(handle);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(err);
        if (err.message && err.message.includes("sub frames")) {
          showAlert("Security Restriction: Browsers block local file picker requests from inside an iframe. Please open this app in a new window/tab to select your Hotfolder.", "Open in New Tab Required");
        } else {
          showAlert(`Failed to select directory: ${err.message}`, "Error");
        }
      }
    }
  };

  // Default copies for newly uploaded files
  const [defaultCopies, setDefaultCopies] = useState<number>(10);
  const [collate, setCollate] = useState<boolean>(false);

  // Material Settings
  const [widthType, setWidthType] = useState<'standard' | 'custom'>('standard');
  const [standardWidth, setStandardWidth] = useState<number>(1370); // mm
  const [customWidthVal, setCustomWidthVal] = useState<number>(1000); // mm
  const [tableLength, setTableLength] = useState<number>(2500); // mm

  // Job metadata
  const [jobName, setJobName] = useState<string>('Imposition Job');

  // Advanced Prepress Settings
  const [forceOrientation, setForceOrientation] = useState<boolean>(false);
  const [hasNativeCutContour, setHasNativeCutContour] = useState<boolean>(false);
  const [addAutoBleed, setAddAutoBleed] = useState<boolean>(false);
  const [addZundQRCode, setAddZundQRCode] = useState<boolean>(false);
  const [generateDoubleSided, setGenerateDoubleSided] = useState<boolean>(false);
  const [cornerRadius, setCornerRadius] = useState<number>(0);

  // UI state for sheet viewer
  const [activeSheetIdx, setActiveSheetIdx] = useState<number>(0);
  const [previewMode, setPreviewMode] = useState<'print' | 'cut'>('print');
  const [backPreview, setBackPreview] = useState<boolean>(false);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  // Presets State
  const [presets, setPresets] = useState<typeof DEFAULT_PRESETS>(DEFAULT_PRESETS);
  const [activePresetId, setActivePresetId] = useState<string>('preset-standard');
  const [newPresetName, setNewPresetName] = useState<string>('');

  // Dialog/Modal State for safe alert and confirm
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type: 'alert' | 'confirm';
    title: string;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    type: 'alert',
    title: '',
    message: ''
  });

  const showAlert = (message: string, title = "Notice") => {
    setDialog({
      isOpen: true,
      type: 'alert',
      title,
      message,
      onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false }))
    });
  };

  const showConfirm = (message: string, onConfirm: () => void, title = "Confirm") => {
    setDialog({
      isOpen: true,
      type: 'confirm',
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setDialog(prev => ({ ...prev, isOpen: false }));
      },
      onCancel: () => setDialog(prev => ({ ...prev, isOpen: false }))
    });
  };

  // Download / Compilation State
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationStep, setGenerationStep] = useState<string>('');
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Canvas Responsive Sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800);

  // Standard roll options in mm
  const standardRolls = [610, 762, 914, 1067, 1118, 1220, 1370, 1524, 1600, 1625, 2000, 2200, 2500, 3200, 5000];
  const standardTableLengths = [800, 1200, 1600, 2500, 3200];

  // Usable width calculation
  const actualMaterialWidth = widthType === 'standard' ? standardWidth : customWidthVal;
  const usableWidth = widthType === 'standard' ? standardWidth - 20 : customWidthVal;

  // Track size changes of canvas container
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Load Presets on Mount
  useEffect(() => {
    const saved = localStorage.getItem('zund_imposition_presets');
    if (saved) {
      try {
        setPresets(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved presets:", e);
      }
    }
  }, []);

  // Preset Handlers
  const saveCurrentAsPreset = () => {
    if (!newPresetName.trim()) {
      showAlert("Please enter a name for the custom template.");
      return;
    }
    const newPreset = {
      id: 'preset-' + Math.random().toString(36).substring(2, 11),
      name: newPresetName.trim(),
      settings: {
        widthType,
        standardWidth,
        customWidthVal,
        tableLength,
        collate,
        forceOrientation,
        hasNativeCutContour,
        addAutoBleed,
        addZundQRCode,
        generateDoubleSided,
        cornerRadius
      }
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    localStorage.setItem('zund_imposition_presets', JSON.stringify(updated));
    setActivePresetId(newPreset.id);
    setNewPresetName('');
    showAlert(`Prepress template "${newPreset.name}" saved successfully!`);
  };

  const loadPreset = (presetId: string) => {
    const found = presets.find(p => p.id === presetId);
    if (found) {
      const s = found.settings;
      setWidthType(s.widthType);
      setStandardWidth(s.standardWidth);
      setCustomWidthVal(s.customWidthVal);
      setTableLength(s.tableLength);
      setCollate(s.collate);
      setForceOrientation(s.forceOrientation);
      setHasNativeCutContour(s.hasNativeCutContour);
      setAddAutoBleed(s.addAutoBleed);
      setAddZundQRCode(s.addZundQRCode);
      setGenerateDoubleSided(s.generateDoubleSided);
      setCornerRadius((s as any).cornerRadius || 0);
      setActivePresetId(presetId);
    }
  };

  const deletePreset = (presetId: string) => {
    const isDefault = ['preset-standard', 'preset-textile', 'preset-double-sided'].includes(presetId);
    if (isDefault) {
      showAlert("Standaard templates kunnen niet worden verwijderd / Default templates cannot be deleted.");
      return;
    }
    const found = presets.find(p => p.id === presetId);
    if (!found) return;

    showConfirm(
      `Weet je zeker dat je de template "${found.name}" wilt verwijderen?\nAre you sure you want to delete template "${found.name}"?`,
      () => {
        const updated = presets.filter(p => p.id !== presetId);
        setPresets(updated);
        localStorage.setItem('zund_imposition_presets', JSON.stringify(updated));
        setActivePresetId('preset-standard');
      },
      "Template verwijderen / Delete Template"
    );
  };

  // Drag and drop event handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadedFiles(Array.from(e.target.files));
    }
  };

  // Helper to parse a single File into UploadedFile format
  const parseFile = (uploadedFile: File, initialCopies: number): Promise<UploadedFile | null> => {
    return new Promise((resolve) => {
      const id = 'file-' + Math.random().toString(36).substring(2, 11);
      if (uploadedFile.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const wMm = Math.round((img.naturalWidth / 150) * 25.4);
            const hMm = Math.round((img.naturalHeight / 150) * 25.4);
            resolve({
              id,
              name: uploadedFile.name,
              base64: reader.result?.toString().split(',')[1] || '',
              mimeType: uploadedFile.type,
              size: uploadedFile.size,
              detectedWidth: wMm,
              detectedHeight: hMm,
              originalWidth: wMm,
              originalHeight: hMm,
              pageCount: 1,
              pdfPagesSpecs: [{ index: 0, w: wMm, h: hMm, detectedW: wMm, detectedH: hMm } as any],
              copies: initialCopies,
              imagePreviewUrl: e.target?.result as string,
              scale: 100,
            });
          };
          img.src = e.target?.result as string;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(uploadedFile);
      } else if (uploadedFile.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            const pdfDoc = await PDFDocument.load(arrayBuffer);
            const pages = pdfDoc.getPages();
            const count = pages.length;

            const specs: PageSpec[] = pages.map((page, idx) => {
              const { width, height } = page.getSize();
              const wVal = Math.round(width * (25.4 / 72));
              const hVal = Math.round(height * (25.4 / 72));
              return {
                index: idx,
                w: wVal,
                h: hVal,
                detectedW: wVal,
                detectedH: hVal
              };
            });

            const base64Reader = new FileReader();
            base64Reader.onloadend = () => {
              const firstPageW = specs[0]?.w || 500;
              const firstPageH = specs[0]?.h || 400;
              resolve({
                id,
                name: uploadedFile.name,
                base64: base64Reader.result?.toString().split(',')[1] || '',
                mimeType: uploadedFile.type,
                size: uploadedFile.size,
                detectedWidth: firstPageW,
                detectedHeight: firstPageH,
                originalWidth: firstPageW,
                originalHeight: firstPageH,
                pageCount: count,
                pdfPagesSpecs: specs,
                copies: initialCopies,
                imagePreviewUrl: null,
                scale: 100,
              });
            };
            base64Reader.readAsDataURL(uploadedFile);
          } catch (err) {
            console.error("PDF Parsing error:", err);
            resolve(null);
          }
        };
        reader.readAsArrayBuffer(uploadedFile);
      } else {
        resolve(null);
      }
    });
  };

  const handleUploadedFiles = async (filesList: FileList | File[]) => {
    setIsParsing(true);
    const parsedFiles: UploadedFile[] = [];
    const invalidFiles: string[] = [];

    for (let i = 0; i < filesList.length; i++) {
      const fileObj = filesList[i];
      const parsed = await parseFile(fileObj, defaultCopies);
      if (parsed) {
        // Run Preflight File Inspection immediately
        try {
          const preflightRes = await fetch('/api/preflight', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              base64: parsed.base64,
              mimeType: parsed.mimeType,
              name: parsed.name
            })
          });
          if (preflightRes.ok) {
            const preflightData = await preflightRes.json();
            if (preflightData.success) {
              parsed.preflight = {
                dpi: preflightData.dpi,
                colorSpace: preflightData.colorSpace,
                warnings: preflightData.warnings || [],
                info: preflightData.info || []
              };
            }
          }
        } catch (preflightErr) {
          console.error("Preflight warning check failed:", preflightErr);
        }
        parsedFiles.push(parsed);
      } else {
        invalidFiles.push(fileObj.name);
      }
    }

    if (invalidFiles.length > 0) {
      showAlert(`The following files could not be parsed or are unsupported:\n${invalidFiles.join('\n')}\n\nPlease upload valid PDF, PNG or JPEG files.`, "Unsupported Files");
    }

    if (parsedFiles.length > 0) {
      setUploadedFiles(prev => {
        const newFiles = [...prev, ...parsedFiles];
        if (prev.length === 0 && parsedFiles[0]) {
          const cleanName = parsedFiles[0].name.replace(/\.[^/.]+$/, "") + " Job";
          setJobName(cleanName);
        }
        return newFiles;
      });
    }
    setIsParsing(false);
  };

  const removeFile = (id: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== id));
    setActiveSheetIdx(0);
  };

  const clearAllFiles = () => {
    setUploadedFiles([]);
    setJobName('Imposition Job');
    setActiveSheetIdx(0);
  };

  const updateFileCopies = (id: string, copiesVal: number) => {
    setUploadedFiles(prev => prev.map(f => {
      if (f.id === id) {
        return { ...f, copies: Math.max(1, copiesVal) };
      }
      return f;
    }));
  };

  const toggleWarningsPopover = (id: string) => {
    setUploadedFiles(prev => prev.map(f => {
      if (f.id === id) {
        return { ...f, showWarningsPopover: !f.showWarningsPopover };
      }
      return { ...f, showWarningsPopover: false };
    }));
  };

  const handleUpdateDimensionsAndScale = (id: string, updateType: 'width' | 'height' | 'scale', val: number) => {
    setUploadedFiles(prev => prev.map(f => {
      if (f.id === id) {
        const detW = f.detectedWidth || f.originalWidth || 100;
        const detH = f.detectedHeight || f.originalHeight || 100;
        
        let newWidth = f.originalWidth;
        let newHeight = f.originalHeight;
        let newScale = f.scale ?? 100;

        if (updateType === 'scale') {
          newScale = Math.max(1, val);
          newWidth = Math.round(detW * (newScale / 100));
          newHeight = Math.round(detH * (newScale / 100));
        } else if (updateType === 'width') {
          newWidth = Math.max(1, val);
          newScale = Math.round((newWidth / detW) * 100);
          newHeight = Math.round(detH * (newScale / 100));
        } else if (updateType === 'height') {
          newHeight = Math.max(1, val);
          newScale = Math.round((newHeight / detH) * 100);
          newWidth = Math.round(detW * (newScale / 100));
        }

        const scaleFactor = newScale / 100;
        const updatedPages = f.pdfPagesSpecs.map((p) => {
          const pageDetW = p.detectedW || p.w;
          const pageDetH = p.detectedH || p.h;
          return {
            ...p,
            detectedW: pageDetW,
            detectedH: pageDetH,
            w: Math.round(pageDetW * scaleFactor),
            h: Math.round(pageDetH * scaleFactor)
          };
        });

        return {
          ...f,
          detectedWidth: detW,
          detectedHeight: detH,
          originalWidth: newWidth,
          originalHeight: newHeight,
          scale: newScale,
          pdfPagesSpecs: updatedPages
        };
      }
      return f;
    }));
  };

  // --- Core Nesting Algorithm (Client Side for Instant Previews) ---
  const nestingResult = useMemo(() => {
    const H_usable = tableLength - 50; 

    // Build repeating queue based on collation
    const queue: { fileIndex: number; pageIndex: number; w: number; h: number }[] = [];
    
    if (collate) {
      const maxCopies = Math.max(...uploadedFiles.map(f => f.copies), 0);
      for (let c = 0; c < maxCopies; c++) {
        uploadedFiles.forEach((f, fIdx) => {
          if (c < f.copies) {
            f.pdfPagesSpecs.forEach(p => {
              // In double-sided mode, only front pages (even indices) are nested
              if (generateDoubleSided && p.index % 2 !== 0) return;
              queue.push({
                fileIndex: fIdx,
                pageIndex: p.index,
                w: p.w,
                h: p.h
              });
            });
          }
        });
      }
    } else {
      uploadedFiles.forEach((f, fIdx) => {
        f.pdfPagesSpecs.forEach(p => {
          if (generateDoubleSided && p.index % 2 !== 0) return;
          for (let c = 0; c < f.copies; c++) {
            queue.push({
              fileIndex: fIdx,
              pageIndex: p.index,
              w: p.w,
              h: p.h
            });
          }
        });
      });
    }

    const pack = (rotate90: boolean) => {
      const sheetsList: NestingSheet[] = [];
      let currentSheet: NestingSheet = { placedItems: [], contentHeight: 0, croppedHeight: 50 };

      let currentX = 0;
      let currentY = 0;
      let currentRowHeight = 0;

      for (let i = 0; i < queue.length; i++) {
        const qItem = queue[i];
        // If bleed is active, packing size is increased by 6mm (3mm on all sides)
        const w = rotate90 
          ? qItem.h + (addAutoBleed ? 6 : 0) 
          : qItem.w + (addAutoBleed ? 6 : 0);
        const h = rotate90 
          ? qItem.w + (addAutoBleed ? 6 : 0) 
          : qItem.h + (addAutoBleed ? 6 : 0);

        const neededXSpace = currentX === 0 ? w : w + 6;

        if (currentX + neededXSpace <= usableWidth) {
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
          // Row overflow: start new row
          const nextY = currentY + currentRowHeight + 6;

          if (nextY + h <= H_usable) {
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
            // Sheet overflow: push previous sheet and start new one
            if (currentSheet.placedItems.length > 0) {
              const maxH = Math.max(...currentSheet.placedItems.map(item => {
                const itemH = (item.rotated ? item.width : item.height) + (addAutoBleed ? 6 : 0);
                return item.y + itemH;
              }));
              currentSheet.contentHeight = maxH;
              currentSheet.croppedHeight = maxH + 50;
              sheetsList.push(currentSheet);
            }

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

      // Add last sheet if items exist
      if (currentSheet.placedItems.length > 0) {
        const maxH = Math.max(...currentSheet.placedItems.map(item => {
          const itemH = (item.rotated ? item.width : item.height) + (addAutoBleed ? 6 : 0);
          return item.y + itemH;
        }));
        currentSheet.contentHeight = maxH;
        currentSheet.croppedHeight = maxH + 50;
        sheetsList.push(currentSheet);
      }

      return sheetsList;
    };

    const sheetsPortrait = pack(false);
    if (forceOrientation) {
      return { sheets: sheetsPortrait, rotated: false };
    }

    const sheetsLandscape = pack(true);

    const totalHPortrait = sheetsPortrait.reduce((sum, s) => sum + s.croppedHeight, 0);
    const totalHLandscape = sheetsLandscape.reduce((sum, s) => sum + s.croppedHeight, 0);

    if (totalHLandscape < totalHPortrait) {
      return { sheets: sheetsLandscape, rotated: true };
    } else {
      return { sheets: sheetsPortrait, rotated: false };
    }
  }, [uploadedFiles, collate, actualMaterialWidth, usableWidth, tableLength, forceOrientation, addAutoBleed, generateDoubleSided]);

  const { sheets, rotated } = nestingResult;

  // Fallback visual safety checks: reset index if overflow
  useEffect(() => {
    if (activeSheetIdx >= sheets.length) {
      setActiveSheetIdx(Math.max(0, sheets.length - 1));
    }
  }, [sheets.length, activeSheetIdx]);

  // Calculations for Bento Panel Stats
  const totalItemsCount = uploadedFiles.reduce((sum, f) => sum + f.pdfPagesSpecs.length * f.copies, 0);
  const totalPlacedCount = sheets.reduce((sum, s) => sum + s.placedItems.length, 0);
  const totalCroppedHeight = sheets.reduce((sum, s) => sum + s.croppedHeight, 0);
  
  const yieldPerMeter = totalCroppedHeight > 0 
    ? parseFloat(((totalPlacedCount / totalCroppedHeight) * 1000).toFixed(2)) 
    : 0;

  const totalItemsArea = uploadedFiles.reduce((sum, f) => {
    const fileArea = f.pdfPagesSpecs.reduce((s, p) => s + (p.w * p.h), 0);
    return sum + fileArea * f.copies;
  }, 0);
  const totalMaterialArea = totalCroppedHeight * actualMaterialWidth;
  const materialUtilization = totalMaterialArea > 0 
    ? parseFloat(((totalItemsArea / totalMaterialArea) * 100).toFixed(1)) 
    : 0;
  const wastePercentage = parseFloat((100 - materialUtilization).toFixed(1));

  // --- Dynamic Canvas scale calculation ---
  const activeSheet = sheets[activeSheetIdx] || { placedItems: [], contentHeight: 0, croppedHeight: 50 };
  
  const scalePxPerMm = useMemo(() => {
    const maxSheetHeight = Math.max(...sheets.map(s => s.croppedHeight), 100);
    const horizontalScale = (containerWidth - 64) / actualMaterialWidth; 
    const verticalScale = 500 / maxSheetHeight; 
    return Math.min(horizontalScale, verticalScale, 0.6); 
  }, [containerWidth, actualMaterialWidth, sheets]);

  const canvasWidthPx = actualMaterialWidth * scalePxPerMm;
  const canvasHeightPx = activeSheet.croppedHeight * scalePxPerMm;

  // PDF Generation Endpoint Call
  const handleGenerateProductionFiles = async () => {
    if (uploadedFiles.length === 0) {
       showAlert("Please upload at least one file first.", "No Files Loaded");
       return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setGenerationStep("Uploading artwork & initializing workspace...");

    try {
      setGenerationStep("Calculating imposition nesting layout...");
      
      const payload = {
        files: uploadedFiles.map(f => ({
          base64: f.base64,
          name: f.name,
          mimeType: f.mimeType,
          originalWidth: f.originalWidth,
          originalHeight: f.originalHeight,
          pageCount: f.pageCount,
          pages: f.pdfPagesSpecs,
          copies: f.copies
        })),
        jobName: jobName || 'Imposition Job',
        collate,
        materialWidth: actualMaterialWidth,
        customWidth: widthType === 'custom',
        tableLength,
        forceOrientation,
        hasNativeCutContour,
        addAutoBleed,
        addZundQRCode,
        generateDoubleSided,
        cornerRadius
      };

      setGenerationStep("Processing PDF pages & adding CutContour spot vectors...");

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errMsg = 'Server error generating imposition files.';
        let errDetails = '';
        
        try {
          const rawText = await response.text();
          try {
            const errorJson = JSON.parse(rawText);
            errMsg = errorJson.error || errorJson.message || errMsg;
            errDetails = errorJson.details ? `\n\nStack Details:\n${errorJson.details}` : '';
          } catch (jsonErr) {
            if (response.status === 413) {
              errMsg = 'The uploaded files are too large for the server to process (413 Payload Too Large).';
              errDetails = '\n\nPlease try uploading smaller PDF/image files or optimizing your artwork files.';
            } else {
              errMsg = `Server error (Status Code: ${response.status} ${response.statusText || ''}).`;
              errDetails = `\n\nRaw Server Response Content:\n${rawText || '[Empty response body]'}`;
            }
          }
        } catch (readErr: any) {
          errMsg = `Failed to read server error response: ${readErr.message}`;
        }

        console.error("Server imposition generation failed. Error:", errMsg, "Details:", errDetails);
        throw new Error(`${errMsg}${errDetails}`);
      }

      const blob = await response.blob();

      if (isHotfolderRoutingEnabled && ripDirHandle && zundDirHandle) {
        setGenerationStep("Extracting and Routing to Hotfolders...");
        try {
          const zipInstance = new JSZip();
          const loadedZip = await zipInstance.loadAsync(blob);
          
          let ripWrittenCount = 0;
          let zundWrittenCount = 0;
          const filesToProcess = Object.entries(loadedZip.files).filter(([_, zipFile]) => !zipFile.dir);

          for (const [fileName, zipFile] of filesToProcess) {
            const fileData = await zipFile.async("uint8array");
            
            if (fileName.includes("_Print")) {
              // Write to RIP Hotfolder
              const fileHandle = await ripDirHandle.getFileHandle(fileName, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(fileData);
              await writable.close();
              ripWrittenCount++;
            } else if (fileName.includes("_Zund")) {
              // Write to Zünd Hotfolder
              const fileHandle = await zundDirHandle.getFileHandle(fileName, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(fileData);
              await writable.close();
              zundWrittenCount++;
            }
          }
          
          showAlert(`Successfully routed ${ripWrittenCount} Print PDF(s) to RIP Hotfolder and ${zundWrittenCount} Cut PDF(s) to Zünd Hotfolder!`, "Routing Successful");
          setGenerationStep("Success! Files routed to hotfolders.");
        } catch (routingErr: any) {
          console.error("Hotfolder routing error:", routingErr);
          throw new Error(`Failed to route files to hotfolders. Please ensure browser permissions are granted. Error: ${routingErr.message}`);
        }
      } else {
        setGenerationStep("Compiling PDF assets and zipping...");
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        
        const rawName = (jobName || 'Imposition_Job').replace(/\s+/g, '_');
        link.setAttribute('download', `${rawName}_Production_Files.zip`);
        
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        setGenerationStep("Download started! Files saved to disk.");
      }
      setTimeout(() => setIsGenerating(false), 2000);
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || 'An error occurred during PDF imposition compilation.');
      setIsGenerating(false);
    }
  };

  // Helper to generate coordinates for intermediate dots on UI
  const getIntermediateDotsY = (heightMm: number) => {
    const dots: number[] = [];
    if (heightMm > 800) {
      let currentY = heightMm - 5 - 800;
      while (currentY > 20) {
        dots.push(currentY);
        currentY -= 800;
      }
    }
    return dots;
  };

  return (
    <div className="min-h-screen md:h-screen flex flex-col bg-slate-100 overflow-hidden font-sans" id="applet-root">
      {/* Sleek Top Banner Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-3 shrink-0 flex items-center justify-between" id="applet-header">
        <div className="flex items-center space-x-3">
          <div className="bg-zinc-900 text-white p-2 rounded-lg shadow-sm">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-zinc-900">Prepress Nesting & Imposition Workspace</h1>
            <p className="text-[11px] text-zinc-500">Professional Zünd cutting & roll-imposition layout generator</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200/60">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse mr-1"></span>
            Server Engine Active
          </span>
        </div>
      </header>

      {/* Main Dashboard Layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Column (Settings Sidebar) */}
        <aside className="w-full md:w-96 bg-zinc-50 border-b md:border-b-0 md:border-r border-zinc-200 flex flex-col h-auto md:h-full overflow-y-auto p-4 shrink-0 space-y-4 shadow-inner" id="sidebar-controls">
          
          {/* Card 0: Prepress Templates (Presets) */}
          <div className="bg-white border border-zinc-200/80 shadow-sm rounded-xl p-4 space-y-3.5" id="card-presets">
            <h2 className="text-xs font-bold text-zinc-900 flex items-center space-x-1.5 uppercase tracking-wider border-b border-zinc-100 pb-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>00. Prepress Templates</span>
            </h2>
            
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 block" htmlFor="select-preset">
                Select Active Template
              </label>
              <div className="flex space-x-1.5">
                <select
                  id="select-preset"
                  value={activePresetId}
                  onChange={(e) => loadPreset(e.target.value)}
                  className="block flex-1 border border-gray-300 rounded bg-zinc-50 font-medium py-1.5 pl-3 pr-10 text-xs focus:ring-blue-500 focus:border-blue-500 focus:outline-none focus:bg-white"
                >
                  {presets.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                  <option value="" disabled>-- Custom Preset Loaded --</option>
                </select>
                {!['preset-standard', 'preset-textile', 'preset-double-sided'].includes(activePresetId) && activePresetId !== '' && (
                  <button
                    type="button"
                    onClick={() => deletePreset(activePresetId)}
                    className="bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 border border-red-200 p-1.5 rounded transition shadow-xs flex items-center justify-center shrink-0"
                    title="Verwijder geselecteerde template / Delete selected template"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="border-t border-zinc-100 pt-2.5 space-y-2">
              <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 block">
                Save Current Config as Template
              </label>
              <div className="flex space-x-1.5">
                <input
                  type="text"
                  placeholder="Template Name..."
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="block flex-1 min-w-0 border border-gray-300 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                />
                <button
                  type="button"
                  onClick={saveCurrentAsPreset}
                  className="bg-zinc-900 hover:bg-zinc-800 text-white p-1.5 rounded transition shadow-xs flex items-center justify-center shrink-0"
                  title="Save current layout configuration"
                >
                  <Save className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Card 1: File & Size */}
          <div className="bg-white border border-zinc-200/80 shadow-sm rounded-xl p-4 space-y-4" id="card-file-size">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
              <h2 className="text-xs font-bold text-zinc-900 flex items-center space-x-1.5 uppercase tracking-wider">
                <FileText className="w-4 h-4 text-zinc-500" />
                <span>01. File & Size</span>
              </h2>
              {uploadedFiles.length > 0 && (
                <button 
                  onClick={clearAllFiles}
                  className="text-[10px] font-bold text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded transition"
                >
                  Clear All
                </button>
              )}
            </div>

            {/* Compact Drag & Drop Zone */}
            <div 
              className={`border-2 border-dashed rounded-lg p-3.5 text-center cursor-pointer transition-all ${
                dragActive 
                  ? 'border-blue-500 bg-blue-50/30' 
                  : 'border-zinc-200 hover:border-zinc-400 bg-zinc-50/40'
              }`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload-input')?.click()}
              id="dropzone"
            >
              <input 
                type="file" 
                id="file-upload-input" 
                className="hidden" 
                accept="application/pdf,image/*" 
                multiple
                onChange={handleFileInput}
              />
              <div className="flex items-center justify-center space-x-2">
                <Upload className="w-4 h-4 text-zinc-400 shrink-0" />
                <div className="text-left">
                  <p className="text-xs font-bold text-zinc-800">Click or drag files here</p>
                  <p className="text-[9px] text-zinc-500 font-medium">Supports multiple PDFs and Images</p>
                </div>
              </div>
            </div>

            {/* List of files with Scale, Width, Height overrides */}
            {uploadedFiles.length > 0 ? (
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1" id="sidebar-uploaded-files">
                {uploadedFiles.map((f, fIdx) => {
                  const colorConfig = FILE_COLORS[fIdx % FILE_COLORS.length] || { hex: '#71717a', textClass: 'text-zinc-600', bgClass: 'bg-zinc-50', borderClass: 'border-zinc-300' };
                  return (
                    <div 
                      key={f.id} 
                      className="bg-zinc-50/70 border border-zinc-200 rounded-lg p-2.5 space-y-2 relative transition-all"
                      style={{ borderLeft: `3px solid ${colorConfig.hex}` }}
                      id={`file-override-${f.id}`}
                    >
                      {/* Name & Remove & Preflight Alerts */}
                      <div className="flex items-start justify-between space-x-1.5">
                        <div className="flex flex-col min-w-0">
                          <span className="text-[11px] font-bold text-zinc-800 truncate" title={f.name}>
                            {f.name}
                          </span>
                          
                          {/* Preflight Brief indicators */}
                          {f.preflight && (
                            <div className="flex items-center space-x-2 mt-0.5">
                              <span className="text-[9px] font-semibold text-zinc-400 font-mono bg-white px-1 border border-zinc-200/40 rounded-sm">
                                {f.preflight.dpi} DPI
                              </span>
                              <span className={`text-[9px] font-semibold font-mono px-1 rounded-sm ${
                                f.preflight.colorSpace === 'CMYK' 
                                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/40'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200/40'
                              }`}>
                                {f.preflight.colorSpace}
                              </span>
                              
                              {/* Warning Alerts Indicator */}
                              {f.preflight.warnings.length > 0 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleWarningsPopover(f.id);
                                  }}
                                  className="text-[9px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-1 py-0.2 rounded border border-amber-300 flex items-center space-x-0.5 animate-pulse shrink-0"
                                  title="Preflight check detected issues. Click to expand diagnostics."
                                >
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  <span>! Preflight Alert</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <button 
                          onClick={() => removeFile(f.id)}
                          className="p-1 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded transition shrink-0 mt-0.5"
                          title="Remove file"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Warnings Diagnostics popover panel */}
                      {f.showWarningsPopover && f.preflight && f.preflight.warnings.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-md p-2 text-[10px] text-amber-900 space-y-1 font-medium shadow-sm animate-fadeIn">
                          <p className="font-bold uppercase tracking-wider text-[8px] text-amber-700 mb-1 border-b border-amber-200 pb-0.5 flex items-center justify-between">
                            <span>Preflight Diagnostics</span>
                            <span className="lowercase font-mono font-normal">({f.preflight.warnings.length} alert)</span>
                          </p>
                          <ul className="list-disc pl-3.5 space-y-0.5 font-sans leading-tight">
                            {f.preflight.warnings.map((warn, wIdx) => (
                              <li key={wIdx}>{warn}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Info: Detected Original Size */}
                      <div className="text-[10px] text-zinc-500 font-mono bg-white border border-zinc-100 rounded px-1.5 py-0.5 inline-block">
                        Detected: {f.detectedWidth || f.originalWidth} x {f.detectedHeight || f.originalHeight} mm
                      </div>

                      {/* Flex row for Scale, Width, Height */}
                      <div className="flex items-center gap-1.5">
                        {/* Scale */}
                        <div className="flex-1 min-w-0">
                          <label className="text-[8px] font-bold uppercase text-zinc-400 block mb-0.5">Scale (%)</label>
                          <input 
                            type="number"
                            value={f.scale ?? 100}
                            min={1}
                            max={1000}
                            onChange={(e) => handleUpdateDimensionsAndScale(f.id, 'scale', Number(e.target.value))}
                            className="block w-full border border-gray-300 rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            title="Scale Percent"
                          />
                        </div>
                        {/* Width */}
                        <div className="flex-1 min-w-0">
                          <label className="text-[8px] font-bold uppercase text-zinc-400 block mb-0.5">Width (mm)</label>
                          <input 
                            type="number"
                            value={f.originalWidth}
                            onChange={(e) => handleUpdateDimensionsAndScale(f.id, 'width', Number(e.target.value))}
                            className="block w-full border border-gray-300 rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            title="Custom Width"
                          />
                        </div>
                        {/* Height */}
                        <div className="flex-1 min-w-0">
                          <label className="text-[8px] font-bold uppercase text-zinc-400 block mb-0.5">Height (mm)</label>
                          <input 
                            type="number"
                            value={f.originalHeight}
                            onChange={(e) => handleUpdateDimensionsAndScale(f.id, 'height', Number(e.target.value))}
                            className="block w-full border border-gray-300 rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            title="Custom Height"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[10px] text-zinc-400 italic text-center py-2">No files queued for imposition.</p>
            )}

            {/* Checkbox: File contains native CutContour (Spot Color) */}
            <div className="flex items-start space-x-2 pt-2 border-t border-zinc-100">
              <div className="flex h-5 items-center">
                <input
                  id="checkbox-native-cutcontour-sidebar"
                  type="checkbox"
                  checked={hasNativeCutContour}
                  onChange={(e) => setHasNativeCutContour(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </div>
              <div className="text-xs">
                <label htmlFor="checkbox-native-cutcontour-sidebar" className="font-bold text-zinc-900 cursor-pointer">
                  File contains native CutContour (Spot Color)
                </label>
                <p className="text-[9px] text-zinc-500 leading-normal">
                  Embed original PDF vector artwork layers directly into both sheets instead of automated rectangular bounding cut lines.
                </p>
              </div>
            </div>
          </div>

          {/* Card 2: Hardware & Media */}
          <div className="bg-white border border-zinc-200/80 shadow-sm rounded-xl p-4 space-y-4" id="card-hardware-media">
            <h2 className="text-xs font-bold text-zinc-900 flex items-center space-x-1.5 uppercase tracking-wider border-b border-zinc-100 pb-2">
              <Settings2 className="w-4 h-4 text-zinc-500" />
              <span>02. Hardware & Media</span>
            </h2>

            {/* Material Width select/input */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Material Width (X-axis)</label>
              
              <div className="flex bg-zinc-100 p-0.5 rounded-lg border border-zinc-200 mb-2">
                <button 
                  type="button"
                  onClick={() => setWidthType('standard')}
                  className={`flex-1 text-center py-1 text-[11px] font-bold rounded transition-all ${
                    widthType === 'standard' 
                      ? 'bg-white text-zinc-900 shadow-sm' 
                      : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                  id="tab-width-standard"
                >
                  Standard Roll
                </button>
                <button 
                  type="button"
                  onClick={() => setWidthType('custom')}
                  className={`flex-1 text-center py-1 text-[11px] font-bold rounded transition-all ${
                    widthType === 'custom' 
                      ? 'bg-white text-zinc-900 shadow-sm' 
                      : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                  id="tab-width-custom"
                >
                  Custom Exact
                </button>
              </div>

              {widthType === 'standard' ? (
                <div className="relative" id="material-width-standard-section">
                  <select 
                    value={standardWidth}
                    onChange={(e) => setStandardWidth(Number(e.target.value))}
                    className="block w-full border border-gray-300 rounded bg-white py-1.5 pl-3 pr-10 text-xs focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                    id="select-standard-width"
                  >
                    {standardRolls.map(w => (
                      <option key={w} value={w}>{w} mm (Usable: {w - 20} mm)</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="relative rounded shadow-sm" id="material-width-custom-section">
                  <input 
                    type="number" 
                    value={customWidthVal}
                    onChange={(e) => setCustomWidthVal(Number(e.target.value))}
                    className="block w-full border border-gray-300 rounded py-1.5 pl-3 pr-10 text-xs font-mono focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                    placeholder="Width in mm"
                    id="input-custom-width"
                  />
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                    <span className="text-[10px] font-bold text-zinc-400">mm</span>
                  </div>
                </div>
              )}
              
              <p className="text-[9px] text-zinc-400">
                {widthType === 'standard' 
                  ? 'Auto-subtracts 20mm for roll printer edge clamp margins.' 
                  : 'Calculates imposition on exact specified material width.'}
              </p>
            </div>

            {/* Zünd table max length */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-500" htmlFor="select-table-length">
                Zünd Max Table Length (Y-axis ceiling)
              </label>
              <select 
                value={tableLength}
                onChange={(e) => setTableLength(Number(e.target.value))}
                className="block w-full border border-gray-300 rounded bg-white py-1.5 pl-3 pr-10 text-xs focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                id="select-table-length"
              >
                {standardTableLengths.map(l => (
                  <option key={l} value={l}>{l} mm</option>
                ))}
              </select>
              <p className="text-[9px] text-zinc-400">
                Ceiling limit for sheets. Artwork will pack in segments within table parameters.
              </p>
            </div>
          </div>

          {/* Card 3: Quantities & Nesting */}
          <div className="bg-white border border-zinc-200/80 shadow-sm rounded-xl p-4 space-y-4" id="card-quantities-nesting">
            <h2 className="text-xs font-bold text-zinc-900 flex items-center space-x-1.5 uppercase tracking-wider border-b border-zinc-100 pb-2">
              <Layers className="w-4 h-4 text-zinc-500" />
              <span>03. Quantities & Nesting</span>
            </h2>

            {/* Default copies tool */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Default Copies (Quick Set)</label>
              <div className="flex space-x-1.5">
                <input 
                  type="number" 
                  value={defaultCopies}
                  min={1}
                  max={1000}
                  onChange={(e) => setDefaultCopies(Math.max(1, Number(e.target.value)))}
                  className="block w-20 border border-gray-300 rounded px-2.5 py-1 text-xs font-mono focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setUploadedFiles(prev => prev.map(f => ({ ...f, copies: defaultCopies })));
                  }}
                  className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border border-zinc-200 text-[10px] font-bold py-1 px-2.5 rounded transition"
                  title="Apply standard copies value to all files"
                >
                  Apply to All
                </button>
              </div>
            </div>

            {/* Pages & Copies Side-by-Side Queue list */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2 border-t border-zinc-100 pt-2.5 max-h-[180px] overflow-y-auto pr-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">Copies Queue</span>
                {uploadedFiles.map((f, fIdx) => (
                  <div key={f.id} className="flex items-center justify-between p-1.5 bg-zinc-50 rounded border border-zinc-100 gap-2">
                    <span className="text-[10px] font-bold text-zinc-700 truncate max-w-[120px]">{f.name}</span>
                    
                    <div className="flex items-center space-x-3 shrink-0">
                      <span className="text-[9px] text-zinc-400 font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-zinc-100">
                        {f.pageCount} P{f.pageCount > 1 ? 's' : ''}
                      </span>
                      <div className="flex items-center space-x-1 bg-white border border-gray-300 rounded p-0.5 shadow-xs">
                        <button 
                          type="button"
                          onClick={() => updateFileCopies(f.id, f.copies - 1)}
                          className="w-4 h-4 flex items-center justify-center bg-zinc-50 hover:bg-zinc-100 text-zinc-700 rounded text-[10px] font-bold"
                        >-</button>
                        <input 
                          type="number"
                          value={f.copies}
                          min={1}
                          onChange={(e) => updateFileCopies(f.id, Number(e.target.value))}
                          className="w-7 text-center bg-transparent border-0 p-0 text-xs font-mono font-bold focus:outline-none"
                        />
                        <button 
                          type="button"
                          onClick={() => updateFileCopies(f.id, f.copies + 1)}
                          className="w-4 h-4 flex items-center justify-center bg-zinc-50 hover:bg-zinc-100 text-zinc-700 rounded text-[10px] font-bold"
                        >+</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Nesting options */}
            <div className="space-y-2.5 border-t border-zinc-100 pt-3">
              {/* Checkbox: Collate as complete sets */}
              <div className="flex items-start space-x-2.5">
                <div className="flex h-5 items-center">
                  <input
                    id="checkbox-collate-sidebar"
                    type="checkbox"
                    checked={collate}
                    onChange={(e) => setCollate(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <div className="text-xs">
                  <label htmlFor="checkbox-collate-sidebar" className="font-bold text-zinc-900 cursor-pointer">
                    Collate as complete sets
                  </label>
                  <p className="text-[9px] text-zinc-500 leading-tight">
                    Prepress ordering: Page sets are printed together (e.g. 1,2,3, 1,2,3) instead of grouping copies.
                  </p>
                </div>
              </div>

              {/* Checkbox: Force original orientation */}
              <div className="flex items-start space-x-2.5">
                <div className="flex h-5 items-center">
                  <input
                    id="checkbox-orientation-sidebar"
                    type="checkbox"
                    checked={forceOrientation}
                    onChange={(e) => setForceOrientation(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <div className="text-xs">
                  <label htmlFor="checkbox-orientation-sidebar" className="font-bold text-zinc-900 cursor-pointer">
                    Force original orientation (no rotate)
                  </label>
                  <p className="text-[9px] text-zinc-500 leading-tight">
                    Disables nesting rotation. Force items to remain in original width/height orientation.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Prepress Options */}
          <div className="bg-white border border-zinc-200/80 shadow-sm rounded-xl p-4 space-y-4" id="card-prepress-options">
            <h2 className="text-xs font-bold text-zinc-900 flex items-center space-x-1.5 uppercase tracking-wider border-b border-zinc-100 pb-2">
              <ArrowLeftRight className="w-4 h-4 text-zinc-500" />
              <span>04. Prepress Options</span>
            </h2>

            <div className="space-y-3.5">
              {/* Checkbox 1: Auto-Bleed 3mm */}
              <div className="flex items-start space-x-2.5">
                <div className="flex h-5 items-center">
                  <input
                    id="checkbox-add-bleed"
                    type="checkbox"
                    checked={addAutoBleed}
                    onChange={(e) => setAddAutoBleed(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <div className="text-xs">
                  <label htmlFor="checkbox-add-bleed" className="font-bold text-zinc-900 cursor-pointer flex items-center space-x-1">
                    <span>Add 3mm Auto-Bleed</span>
                    <span className="bg-blue-100 text-blue-800 text-[8px] font-black px-1 rounded uppercase tracking-wider">Adv</span>
                  </label>
                  <p className="text-[9px] text-zinc-500 leading-normal">
                    Generate 3mm mirrored margins for images and scale PDF artwork. Nesting math automatically updates to accommodate bleeds.
                  </p>
                </div>
              </div>

              {/* Checkbox 2: Zünd QR Code */}
              <div className="flex items-start space-x-2.5 border-t border-zinc-100 pt-2.5">
                <div className="flex h-5 items-center">
                  <input
                    id="checkbox-add-qrcode"
                    type="checkbox"
                    checked={addZundQRCode}
                    onChange={(e) => setAddZundQRCode(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <div className="text-xs">
                  <label htmlFor="checkbox-add-qrcode" className="font-bold text-zinc-900 cursor-pointer flex items-center space-x-1">
                    <span>Add Zünd QR-Code</span>
                  </label>
                  <p className="text-[9px] text-zinc-500 leading-normal">
                    Insert a scannable QR Code containing the job name in the bottom margin area. Enabled on print sheets only.
                  </p>
                </div>
              </div>

              {/* Checkbox 3: Double-Sided generation */}
              <div className="flex items-start space-x-2.5 border-t border-zinc-100 pt-2.5">
                <div className="flex h-5 items-center">
                  <input
                    id="checkbox-double-sided"
                    type="checkbox"
                    checked={generateDoubleSided}
                    onChange={(e) => {
                      setGenerateDoubleSided(e.target.checked);
                      if (!e.target.checked) setBackPreview(false);
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <div className="text-xs">
                  <label htmlFor="checkbox-double-sided" className="font-bold text-zinc-900 cursor-pointer flex items-center space-x-1">
                    <span>Generate Double-Sided (Back sheet)</span>
                  </label>
                  <p className="text-[9px] text-zinc-500 leading-normal">
                    Outputs a mirrored back print sheet. Aligns perfectly with front items when horizontally flipped on production cutter.
                  </p>
                </div>
              </div>

              {/* Number Input: Corner Radius */}
              <div className="border-t border-zinc-100 pt-3.5 space-y-2">
                <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 block" htmlFor="input-corner-radius">
                  CutContour Corner Radius (mm)
                </label>
                <div className="relative rounded shadow-xs">
                  <input
                    id="input-corner-radius"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={cornerRadius}
                    onChange={(e) => setCornerRadius(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="block w-full border border-gray-300 rounded py-1.5 pl-3 pr-10 text-xs font-mono focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                    placeholder="e.g. 5"
                  />
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                    <span className="text-[10px] font-bold text-zinc-400">mm</span>
                  </div>
                </div>
                <p className="text-[9px] text-zinc-500 leading-normal">
                  Smooths 90° corners with curves. Allows tangential cutting knives on Zünd tables to operate at maximum speed.
                </p>
              </div>
            </div>
          </div>

          {/* Card 5: Hotfolder Routing */}
          <div className="bg-white border border-zinc-200/80 shadow-sm rounded-xl p-4 space-y-4 animate-fadeIn" id="card-hotfolder-routing">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="toggle-hotfolder-routing"
                  checked={isHotfolderRoutingEnabled}
                  onChange={(e) => setIsHotfolderRoutingEnabled(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-zinc-300 rounded focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="toggle-hotfolder-routing" className="text-xs font-bold text-zinc-900 flex items-center space-x-1.5 uppercase tracking-wider cursor-pointer select-none">
                  <FolderOpen className="w-4 h-4 text-zinc-500" />
                  <span>05. Hotfolder Routing</span>
                </label>
              </div>
            </div>
            
            <p className="text-[10px] text-zinc-500 leading-normal">
              Route imposition outputs directly to local RIP and Zünd hotfolders using the browser's File System Access API.
            </p>

            {window.self !== window.top && isHotfolderRoutingEnabled && (
              <div className="bg-amber-50 border border-amber-200/60 rounded-lg p-2.5 space-y-1">
                <div className="flex items-start space-x-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-[10px] font-medium text-amber-800 leading-normal">
                    <span className="font-bold">Iframe restriction active:</span> Browsers prevent selecting folders inside subframes. To use Hotfolder Routing, please click <span className="font-bold underline">Open in New Tab</span> at the top of the screen.
                  </div>
                </div>
              </div>
            )}

            <div className={`space-y-3.5 transition-opacity duration-200 ${isHotfolderRoutingEnabled ? 'opacity-100' : 'opacity-40'}`}>
              {/* RIP Hotfolder */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 block">
                  RIP Hotfolder Destination
                </label>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleSelectRipHotfolder}
                    className="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-200 text-[10px] font-bold py-1.5 px-2.5 rounded transition shrink-0"
                  >
                    Select RIP Hotfolder
                  </button>
                  {ripDirHandle ? (
                    <span className="text-[11px] text-emerald-600 flex items-center space-x-1 min-w-0" id="rip-hotfolder-confirmation">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="truncate font-semibold" title={ripDirHandle.name}>
                        {ripDirHandle.name}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-400 italic">None selected</span>
                  )}
                </div>
              </div>

              {/* Zünd Hotfolder */}
              <div className="space-y-1.5 border-t border-zinc-100 pt-2.5">
                <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 block">
                  Zünd Hotfolder Destination
                </label>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleSelectZundHotfolder}
                    className="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-200 text-[10px] font-bold py-1.5 px-2.5 rounded transition shrink-0"
                  >
                    Select Zünd Hotfolder
                  </button>
                  {zundDirHandle ? (
                    <span className="text-[11px] text-emerald-600 flex items-center space-x-1 min-w-0" id="zund-hotfolder-confirmation">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="truncate font-semibold" title={zundDirHandle.name}>
                        {zundDirHandle.name}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-400 italic">None selected</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Column (Live Preview & Output) */}
        <main className="flex-grow flex flex-col h-full overflow-hidden p-5" id="preview-area">
          
          {/* Prepress Control Command Bar */}
          <div className="bg-white border border-zinc-200 rounded-xl p-4 mb-4 flex flex-wrap items-center justify-between gap-4 shadow-xs shrink-0" id="canvas-header">
            {/* Job Name */}
            <div className="flex items-center space-x-3 flex-grow max-w-md">
              <span className="text-xs font-black text-zinc-400 uppercase tracking-wider shrink-0 font-mono">Job ID</span>
              <input 
                type="text" 
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                className="block flex-grow border border-gray-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-xs font-bold font-mono bg-zinc-50/50"
                placeholder="Enter Imposition Job Name"
                id="job-name-input-top"
              />
            </div>

            {/* Action and Output controls */}
            <div className="flex items-center flex-wrap gap-3">
              {/* Sheet Navigation indicator */}
              {uploadedFiles.length > 0 && sheets.length > 0 && (
                <div className="flex items-center space-x-2 bg-zinc-50 border border-zinc-200 rounded-lg p-1 font-mono shrink-0">
                  <button 
                    disabled={activeSheetIdx === 0}
                    onClick={() => setActiveSheetIdx(prev => Math.max(0, prev - 1))}
                    className="p-1 text-zinc-600 hover:bg-zinc-200/60 disabled:text-zinc-300 disabled:hover:bg-transparent rounded transition"
                    id="btn-prev-sheet"
                    title="Previous nested sheet"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-bold text-zinc-800 px-1 select-none">
                    Sheet {activeSheetIdx + 1} of {sheets.length}
                  </span>
                  <button 
                    disabled={activeSheetIdx === sheets.length - 1}
                    onClick={() => setActiveSheetIdx(prev => Math.min(sheets.length - 1, prev + 1))}
                    className="p-1 text-zinc-600 hover:bg-zinc-200/60 disabled:text-zinc-300 disabled:hover:bg-transparent rounded transition"
                    id="btn-next-sheet"
                    title="Next nested sheet"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Front / Back Mirroring Toggle (Visible only if Double-Sided is active) */}
              {generateDoubleSided && uploadedFiles.length > 0 && sheets.length > 0 && (
                <div className="flex bg-zinc-100 p-0.5 rounded-lg border border-zinc-200 shrink-0">
                  <button
                    onClick={() => setBackPreview(false)}
                    className={`px-2.5 py-1 text-xs font-bold rounded transition-all flex items-center space-x-1 ${
                      !backPreview 
                        ? 'bg-zinc-900 text-white shadow-xs' 
                        : 'text-zinc-500 hover:text-zinc-800'
                    }`}
                  >
                    <span>FRONT</span>
                  </button>
                  <button
                    onClick={() => setBackPreview(true)}
                    className={`px-2.5 py-1 text-xs font-bold rounded transition-all flex items-center space-x-1 ${
                      backPreview 
                        ? 'bg-zinc-900 text-white shadow-xs' 
                        : 'text-zinc-500 hover:text-zinc-800'
                    }`}
                  >
                    <span>BACK (Mirrored)</span>
                  </button>
                </div>
              )}

              {/* Print/Cut Toggle */}
              <div className="flex bg-zinc-100 p-0.5 rounded-lg border border-zinc-200 shrink-0">
                <button 
                  onClick={() => setPreviewMode('print')}
                  className={`flex items-center space-x-1 px-2.5 py-1 text-xs font-bold rounded transition-all ${
                    previewMode === 'print' 
                      ? 'bg-white text-zinc-900 shadow-xs' 
                      : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                  id="btn-preview-print"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Print View</span>
                </button>
                <button 
                  onClick={() => setPreviewMode('cut')}
                  className={`flex items-center space-x-1 px-2.5 py-1 text-xs font-bold rounded transition-all ${
                    previewMode === 'cut' 
                      ? 'bg-white text-pink-600 shadow-xs' 
                      : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                  id="btn-preview-cut"
                >
                  <Scissors className="w-3.5 h-3.5 text-pink-500" />
                  <span>Cut View</span>
                </button>
              </div>

              {/* Primary Action Button (Generate Production Files) */}
              <button
                onClick={handleGenerateProductionFiles}
                disabled={isGenerating || uploadedFiles.length === 0 || isParsing}
                className={`flex items-center justify-center space-x-2 py-1.5 px-4 rounded-lg text-xs font-bold text-white shadow transition-all shrink-0 ${
                  isGenerating || uploadedFiles.length === 0 || isParsing
                    ? 'bg-zinc-400 cursor-not-allowed shadow-none'
                    : 'bg-blue-600 hover:bg-blue-700 hover:shadow-md active:scale-98'
                }`}
                id="btn-generate-files"
              >
                {isGenerating ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>
                  {isGenerating 
                    ? 'Generating...' 
                    : (isHotfolderRoutingEnabled && ripDirHandle && zundDirHandle 
                      ? 'Generate & Route to Hotfolders' 
                      : 'Generate RIP Files')}
                </span>
              </button>
            </div>
          </div>

          {/* Dedicated Error and Alert display layout */}
          {generationError && (
            <div className="bg-red-100 text-red-800 border-l-4 border-red-500 p-4 rounded-lg flex items-start space-x-2 mb-4 shadow-sm shrink-0" id="error-alert">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
              <div className="space-y-1 w-full overflow-auto">
                <p className="font-bold text-sm">Prepress Compilation Error</p>
                <p className="text-xs leading-relaxed font-mono whitespace-pre-wrap">{generationError}</p>
              </div>
            </div>
          )}

          {/* Warning Box if queue empty */}
          {uploadedFiles.length === 0 && (
            <div className="bg-amber-50 text-amber-800 border-l-4 border-amber-500 p-4 rounded-lg flex items-start space-x-3 mb-4 shadow-sm shrink-0">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <p className="font-bold text-sm">Active Queue Empty</p>
                <p className="text-xs leading-relaxed mt-1">
                  Please upload one or more source files (PDF / image) in the sidebar. Once uploaded, real-time nesting layouts will generate instantly.
                </p>
              </div>
            </div>
          )}

          {/* Live Progress feedback */}
          {isGenerating && (
            <div className="bg-zinc-900 text-zinc-100 rounded-xl p-3.5 mb-4 space-y-2 border border-zinc-800 shadow-md shrink-0" id="progress-indicator">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase font-bold tracking-wider text-blue-400">Processing Imposition Run</span>
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
              </div>
              <p className="text-xs font-mono font-bold leading-relaxed text-zinc-200">{generationStep}</p>
              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-blue-500 h-full animate-pulse transition-all duration-300" style={{ width: '65%' }}></div>
              </div>
            </div>
          )}

          {/* Bento Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 shrink-0" id="bento-stats">
            {/* Stat 1: Yield */}
            <div className="bg-white border border-zinc-200/80 shadow-xs rounded-xl p-3 flex flex-col justify-between" id="bento-yield">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Required Linear Meters</span>
              <div className="mt-1 flex items-baseline space-x-1">
                <span className="text-xl font-black text-zinc-950 font-mono">
                  {uploadedFiles.length > 0 ? (totalCroppedHeight / 1000).toFixed(2) : '0.00'}
                </span>
                <span className="text-[10px] text-zinc-500 font-medium">m</span>
              </div>
            </div>

            {/* Stat 2: Material Efficiency */}
            <div className="bg-white border border-zinc-200/80 shadow-xs rounded-xl p-3 flex flex-col justify-between" id="bento-utilization">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Material Efficiency</span>
              <div className="mt-1">
                <div className="flex items-baseline space-x-1">
                  <span className="text-xl font-black text-zinc-950 font-mono">
                    {uploadedFiles.length > 0 ? materialUtilization : '0'}%
                  </span>
                  <span className="text-[9px] text-emerald-600 font-bold bg-emerald-50 px-1 rounded">
                    -{uploadedFiles.length > 0 ? wastePercentage : '0'}% waste
                  </span>
                </div>
                <div className="w-full bg-zinc-100 h-1 rounded-full overflow-hidden mt-1.5">
                  <div 
                    className="bg-zinc-800 h-full transition-all duration-500" 
                    style={{ width: `${uploadedFiles.length > 0 ? materialUtilization : 0}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Stat 3: Nesting Vector */}
            <div className="bg-white border border-zinc-200/80 shadow-xs rounded-xl p-3 flex flex-col justify-between" id="bento-orientation">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Nesting Vector</span>
              <div className="mt-1 flex flex-wrap gap-1 items-center">
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                  uploadedFiles.length > 0 
                    ? rotated 
                    : 'bg-zinc-100 text-zinc-400'
                }`}>
                  {uploadedFiles.length > 0 ? (rotated ? '90° ROTATED' : '0° ORIGINAL') : 'N/A'}
                </span>
                {addAutoBleed && (
                  <span className="bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded text-[10px] font-bold font-mono">
                    BLEED (3mm)
                  </span>
                )}
              </div>
            </div>

            {/* Stat 4: Sheet Count */}
            <div className="bg-white border border-zinc-200/80 shadow-xs rounded-xl p-3 flex flex-col justify-between" id="bento-sheets">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Production Volume</span>
              <div className="mt-1 flex items-baseline space-x-1">
                <span className="text-xl font-black text-zinc-950 font-mono">
                  {uploadedFiles.length > 0 ? sheets.length : '0'}
                </span>
                <span className="text-[10px] text-zinc-500 ml-1">
                  Sheet{sheets.length > 1 ? 's' : ''} {generateDoubleSided ? ' (x2 sides)' : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Scaled Digital Canvas Preview Card */}
          <div className="bg-white border border-zinc-200/80 shadow-xs rounded-xl overflow-hidden flex flex-col flex-grow min-h-0" id="card-canvas">
            
            {/* Canvas Render Panel Container */}
            <div 
              ref={containerRef}
              className={`flex-grow bg-zinc-50 p-6 flex justify-center relative overflow-auto ${
                uploadedFiles.length > 0 ? 'items-start' : 'items-center'
              }`}
              id="canvas-scroll-container"
            >
              {isParsing ? (
                <div className="flex flex-col items-center justify-center space-y-3 py-12" id="canvas-parsing">
                  <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                  <p className="text-xs font-bold text-zinc-500">Parsing uploaded file geometry...</p>
                </div>
              ) : uploadedFiles.length === 0 ? (
                <div className="text-center py-16 space-y-4 max-w-sm" id="canvas-placeholder">
                  <div className="bg-white p-4 rounded-full border border-zinc-200 shadow-sm inline-block mx-auto">
                    <Layers className="w-8 h-8 text-zinc-400" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-sm font-bold text-zinc-900">Prepress Workspace Empty</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      Upload source artworks (PDF/images) in the sidebar to calculate layout coordinates and view immediate roll-imposition nests.
                    </p>
                  </div>
                </div>
              ) : (
                /* Dynamic scaled sheet visualizer */
                <div 
                  className="bg-white shadow-md border border-zinc-300 relative transition-all duration-300 select-none"
                  style={{
                    width: `${canvasWidthPx}px`,
                    height: `${canvasHeightPx}px`,
                  }}
                  id="scaled-sheet-canvas"
                >
                  
                  {/* Grid overlay for technical/blueprint visual feel */}
                  <div className="absolute inset-0 grid-bg opacity-15 pointer-events-none"></div>

                  {/* Left Side margin visual indicator (10mm) */}
                  <div 
                    className="absolute inset-y-0 left-0 border-r border-dashed border-sky-400 bg-sky-50/10 pointer-events-none"
                    style={{ width: `${10 * scalePxPerMm}px` }}
                    title="Edge safety margin (10mm)"
                  ></div>

                  {/* Right Side margin visual indicator (10mm) */}
                  <div 
                    className="absolute inset-y-0 right-0 border-l border-dashed border-sky-400 bg-sky-50/10 pointer-events-none"
                    style={{ width: `${10 * scalePxPerMm}px` }}
                    title="Edge safety margin (10mm)"
                  ></div>

                  {/* Top vertical margin visual indicator (25mm) */}
                  <div 
                    className="absolute inset-x-0 top-0 border-b border-dashed border-indigo-400 bg-indigo-50/10 pointer-events-none"
                    style={{ height: `${25 * scalePxPerMm}px` }}
                    title="Text and dot margin (25mm)"
                  ></div>

                  {/* Bottom vertical margin visual indicator (25mm) */}
                  <div 
                    className="absolute inset-x-0 bottom-0 border-t border-dashed border-indigo-400 bg-indigo-50/10 pointer-events-none"
                    style={{ height: `${25 * scalePxPerMm}px` }}
                    title="Text and dot margin (25mm)"
                  ></div>

                  {/* Render nested items in current sheet */}
                  {(() => {
                    // Maximum right edge calculation
                    const maxRightEdge = activeSheet.placedItems.length > 0 
                      ? Math.max(...activeSheet.placedItems.map(item => {
                          const itemW = (item.rotated ? item.height : item.width) + (addAutoBleed ? 6 : 0);
                          return item.x + itemW;
                        }))
                      : 0;
                    const hOffset = (actualMaterialWidth - maxRightEdge) / 2;

                    return activeSheet.placedItems.map((item) => {
                      const itemH = item.rotated ? item.width : item.height;
                      const itemW = item.rotated ? item.height : item.width;
                      
                      // If bleed is active, the physical visual boundaries increase by 6mm
                      const bleedW = itemW + (addAutoBleed ? 6 : 0);
                      const bleedH = itemH + (addAutoBleed ? 6 : 0);

                      // HORIZONTAL MIRRORING IN BACK PREVIEW
                      const xFrontMm = item.x + hOffset;
                      const xPosMm = backPreview 
                        ? (actualMaterialWidth - bleedW - xFrontMm) 
                        : xFrontMm;

                      const xPx = xPosMm * scalePxPerMm;
                      const topPx = (activeSheet.croppedHeight - (item.y + 25 + bleedH)) * scalePxPerMm;
                      const widthPx = bleedW * scalePxPerMm;
                      const heightPx = bleedH * scalePxPerMm;

                      const fileObj = uploadedFiles[item.fileIndex];
                      const itemImagePreviewUrl = fileObj?.imagePreviewUrl;
                      const isHovered = hoveredItemId === item.id;
                      const colorConfig = FILE_COLORS[item.fileIndex % FILE_COLORS.length] || { hex: '#71717a', textClass: 'text-zinc-600', bgClass: 'bg-zinc-50/70', borderClass: 'border-zinc-300' };

                      // Page-to-page mirroring pairing for back sheets: front P nests, back P + 1 (if available), else P
                      let pageIdxToRender = item.pageIndex;
                      if (backPreview && item.pageIndex % 2 === 0 && fileObj && fileObj.pageCount > item.pageIndex + 1) {
                        pageIdxToRender = item.pageIndex + 1;
                      }

                      return (
                        <div
                          key={item.id}
                          className={`absolute box-border transition-all duration-150 ${
                            previewMode === 'cut' 
                              ? 'border-0 bg-transparent' 
                              : 'shadow-xs'
                          }`}
                          style={{
                            left: `${xPx}px`,
                            top: `${topPx}px`,
                            width: `${widthPx}px`,
                            height: `${heightPx}px`,
                            border: previewMode === 'print' ? `2px solid ${colorConfig.hex}` : undefined,
                            backgroundColor: previewMode === 'print' ? 'white' : undefined,
                          }}
                          onMouseEnter={() => setHoveredItemId(item.id)}
                          onMouseLeave={() => setHoveredItemId(null)}
                        >
                          {/* Print preview mode details (Show Artwork thumbnail/Blueprint placeholder) */}
                          {previewMode === 'print' && (
                            <div className="w-full h-full relative overflow-hidden flex flex-col justify-between p-1">
                              
                              {/* File marker badge */}
                              <div 
                                className="absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-extrabold text-white z-10 shadow-sm flex items-center space-x-0.5 select-none font-mono"
                                style={{ backgroundColor: colorConfig.hex }}
                              >
                                <span>F{item.fileIndex + 1}</span>
                                <span className="opacity-60">|</span>
                                <span>P{pageIdxToRender + 1}</span>
                              </div>

                              {itemImagePreviewUrl ? (
                                <div 
                                  className="absolute inset-0 bg-cover bg-center"
                                  style={{ 
                                    backgroundImage: `url(${itemImagePreviewUrl})`,
                                    transform: item.rotated ? 'rotate(90deg)' : 'none',
                                  }}
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                // Technical grid/blueprint layout for PDFs
                                <div className={`absolute inset-0 flex flex-col items-center justify-center p-1 select-none pointer-events-none ${colorConfig.bgClass}`}>
                                  <div className="absolute inset-0 opacity-10 grid-bg-blue"></div>
                                  <FileText className={`w-3.5 h-3.5 ${colorConfig.textClass} opacity-85 mb-0.5 shrink-0 mt-2`} />
                                  <span className={`text-[8px] font-black ${colorConfig.textClass} font-mono`}>
                                    P.{pageIdxToRender + 1}
                                  </span>
                                  <span className={`text-[8px] font-semibold ${colorConfig.textClass} font-mono tracking-tight mt-0.5 max-w-full truncate px-0.5`} title={fileObj?.name}>
                                    {fileObj?.name || 'Artwork'}
                                  </span>
                                  <span className="text-[7px] text-zinc-500 font-mono tracking-tight mt-0.5">
                                    {item.width}x{item.height} mm
                                  </span>
                                </div>
                              )}

                              {/* 3mm Bleed overlay line inside the printed box */}
                              {addAutoBleed && (
                                <div 
                                  className="absolute border border-dashed border-pink-500 pointer-events-none z-10"
                                  style={{
                                    left: `${3 * scalePxPerMm}px`,
                                    top: `${3 * scalePxPerMm}px`,
                                    width: `${itemW * scalePxPerMm}px`,
                                    height: `${itemH * scalePxPerMm}px`,
                                  }}
                                  title="Original cut size boundary (3mm offset)"
                                >
                                  <div className="absolute top-0.5 left-0.5 bg-pink-500 text-white font-mono text-[6px] font-black px-0.5 rounded-sm select-none uppercase scale-90 origin-top-left">
                                    CUT LINE
                                  </div>
                                </div>
                              )}

                              {/* Rotate indicator visual */}
                              {item.rotated && (
                                <span className="absolute top-1 right-1 bg-pink-500/90 text-[7px] text-white font-bold font-mono px-1 py-0.2 rounded-xs select-none uppercase tracking-wider z-10">
                                  Rotated
                                </span>
                              )}

                              {/* Label overlay on hover */}
                              {isHovered && (
                                <div className="absolute inset-0 bg-zinc-950/95 text-white p-2 text-[9px] space-y-1 z-20 overflow-auto pointer-events-none flex flex-col justify-center font-medium">
                                  <p className="font-bold border-b border-zinc-700 pb-0.5 truncate text-center text-blue-400">
                                    {fileObj?.name || 'Artwork'}
                                  </p>
                                  <p className="font-mono flex justify-between text-zinc-300">
                                    <span>Rendered Page:</span>
                                    <span className="text-white font-bold">{pageIdxToRender + 1}</span>
                                  </p>
                                  <p className="font-mono flex justify-between text-zinc-300">
                                    <span>Cut Dimension:</span> 
                                    <span className="text-white font-bold">{item.width}x{item.height}mm</span>
                                  </p>
                                  {addAutoBleed && (
                                    <p className="font-mono flex justify-between text-zinc-300">
                                      <span>Bleed Box Size:</span> 
                                      <span className="text-pink-400 font-bold">{item.width + 6}x{item.height + 6}mm</span>
                                    </p>
                                  )}
                                  <p className="font-mono flex justify-between text-zinc-300">
                                    <span>Canvas X:</span> 
                                    <span className="text-white font-bold">{(item.x + hOffset).toFixed(0)}mm</span>
                                  </p>
                                  <p className="font-mono flex justify-between text-zinc-300">
                                    <span>Canvas Y:</span> 
                                    <span className="text-white font-bold">{(item.y + 25).toFixed(0)}mm</span>
                                  </p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Zünd Cut preview mode details (Vibrant spot color contour line) */}
                          {previewMode === 'cut' && (
                            <div className="w-full h-full relative">
                              {/* Draw exact cut contours: centered inside bleed box if bleed is enabled */}
                              <div
                                className="absolute border-1.5 border-pink-500 bg-pink-500/5 transition-all"
                                style={{
                                  left: addAutoBleed ? `${3 * scalePxPerMm}px` : '0px',
                                  top: addAutoBleed ? `${3 * scalePxPerMm}px` : '0px',
                                  width: `${itemW * scalePxPerMm}px`,
                                  height: `${itemH * scalePxPerMm}px`,
                                }}
                              />

                              {isHovered && (
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-pink-600/95 text-white px-2.5 py-1 rounded-md shadow-xl text-[8px] z-30 pointer-events-none font-mono whitespace-nowrap leading-tight text-center">
                                  <p className="font-bold border-b border-pink-400 pb-0.5 mb-1">Cutter Vector</p>
                                  <p>Spot Name: <span className="font-bold text-yellow-300">CutContour</span></p>
                                  <p>Coordinates: <span className="font-bold">{(item.x + hOffset + (addAutoBleed ? 3 : 0)).toFixed(0)}, {(item.y + 25 + (addAutoBleed ? 3 : 0)).toFixed(0)} mm</span></p>
                                  <p>Dimension: <span className="font-bold">{item.width} x {item.height} mm</span></p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}

                  {/* Draw Zünd orientation registration dots (5mm diameter) */}
                  {[
                    { x: 5, y: 5, label: 'Bottom Left' },
                    { x: actualMaterialWidth - 5, y: 5, label: 'Bottom Right' },
                    { x: 5, y: activeSheet.croppedHeight - 5, label: 'Top Left' },
                    { x: actualMaterialWidth - 5, y: activeSheet.croppedHeight - 5, label: 'Top Right' },
                  ].map((dot, idx) => {
                    const dSize = 5 * scalePxPerMm;
                    const topPx = (activeSheet.croppedHeight - dot.y) * scalePxPerMm - dSize / 2;
                    const leftPx = dot.x * scalePxPerMm - dSize / 2;

                    return (
                      <div 
                        key={`corner-dot-${idx}`}
                        className="absolute bg-zinc-950 rounded-full border border-white z-20 flex items-center justify-center shadow-xs"
                        style={{
                          width: `${dSize}px`,
                          height: `${dSize}px`,
                          left: `${leftPx}px`,
                          top: `${topPx}px`,
                        }}
                        title={`Registration dot (${dot.label}): (${dot.x.toFixed(1)}, ${dot.y.toFixed(1)})`}
                      >
                        <div className="w-full h-[0.5px] bg-white absolute"></div>
                        <div className="h-full w-[0.5px] bg-white absolute"></div>
                      </div>
                    );
                  })}

                  {/* Draw 5th orientation dot: bottom right margin, mirrored on Back sheets */}
                  {(() => {
                    const dotX = backPreview ? 32.5 : actualMaterialWidth - 32.5;
                    const dotY = 5;
                    const dSize = 5 * scalePxPerMm;
                    const topPx = (activeSheet.croppedHeight - dotY) * scalePxPerMm - dSize / 2;
                    const leftPx = dotX * scalePxPerMm - dSize / 2;

                    return (
                      <div 
                        className="absolute bg-zinc-950 rounded-full border-2 border-white z-20 flex items-center justify-center shadow-xs"
                        style={{
                          width: `${dSize}px`,
                          height: `${dSize}px`,
                          left: `${leftPx}px`,
                          top: `${topPx}px`,
                        }}
                        title={`5th Orientation Dot: (${dotX}, ${dotY})`}
                      >
                        <div className="w-full h-[0.5px] bg-white absolute"></div>
                        <div className="h-full w-[0.5px] bg-white absolute"></div>
                      </div>
                    );
                  })()}

                  {/* Draw Zünd Long Sheet intermediate registration dots step-down (every 800 mm) */}
                  {getIntermediateDotsY(activeSheet.croppedHeight).map((dotY, idx) => {
                    const dSize = 5 * scalePxPerMm;
                    const topPx = (activeSheet.croppedHeight - dotY) * scalePxPerMm - dSize / 2;
                    
                    const leftDotX = 5 * scalePxPerMm - dSize / 2;
                    const rightDotX = (actualMaterialWidth - 5) * scalePxPerMm - dSize / 2;

                    return (
                      <React.Fragment key={`inter-dot-grp-${idx}`}>
                        <div 
                          className="absolute bg-zinc-950 rounded-full border border-white z-20 flex items-center justify-center shadow-xs"
                          style={{
                            width: `${dSize}px`,
                            height: `${dSize}px`,
                            left: `${leftDotX}px`,
                            top: `${topPx}px`,
                          }}
                          title={`Intermediate registration dot: (5, ${dotY})`}
                        >
                          <div className="w-full h-[0.5px] bg-white absolute"></div>
                          <div className="h-full w-[0.5px] bg-white absolute"></div>
                        </div>

                        <div 
                          className="absolute bg-zinc-950 rounded-full border border-white z-20 flex items-center justify-center shadow-xs"
                          style={{
                            width: `${dSize}px`,
                            height: `${dSize}px`,
                            left: `${rightDotX}px`,
                            top: `${topPx}px`,
                          }}
                          title={`Intermediate registration dot: (${actualMaterialWidth - 5}, ${dotY})`}
                        >
                          <div className="w-full h-[0.5px] bg-white absolute"></div>
                          <div className="h-full w-[0.5px] bg-white absolute"></div>
                        </div>
                      </React.Fragment>
                    );
                  })}

                  {/* Prepress Job name Text Label at X: 50mm, Y: 12mm */}
                  {previewMode === 'print' && (
                    <div 
                      className="absolute text-zinc-950 font-mono font-bold tracking-tight select-none pointer-events-none text-left leading-none"
                      style={{
                        left: backPreview ? undefined : `${50 * scalePxPerMm}px`,
                        right: backPreview ? `${50 * scalePxPerMm}px` : undefined,
                        bottom: `${12 * scalePxPerMm}px`,
                        fontSize: `${Math.max(8, 10 * scalePxPerMm)}px`
                      }}
                    >
                      {jobName || 'Imposition Job'} | Sheet {activeSheetIdx + 1} of {sheets.length} {backPreview ? '| BACK' : ''}
                    </div>
                  )}

                  {/* Draw scannable QR Code representation inside bottom margin of preview if enabled */}
                  {previewMode === 'print' && addZundQRCode && (
                    <div
                      className="absolute bg-white border border-zinc-900 flex flex-col items-center justify-center pointer-events-none z-20 p-0.5 animate-fadeIn"
                      style={{
                        left: backPreview ? `${50 * scalePxPerMm}px` : `${(actualMaterialWidth - 65) * scalePxPerMm}px`,
                        bottom: `${5 * scalePxPerMm}px`,
                        width: `${15 * scalePxPerMm}px`,
                        height: `${15 * scalePxPerMm}px`
                      }}
                      title="Zünd Prepress QR Code job marker"
                    >
                      <QrCode className="w-full h-full text-zinc-950" />
                    </div>
                  )}

                </div>
              )}
            </div>

            {/* Canvas footer informational strip */}
            <div className="border-t border-zinc-200 bg-zinc-50/50 px-4 py-2.5 flex items-center justify-between text-[11px] text-zinc-500 shrink-0 font-mono" id="canvas-footer">
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 bg-sky-400 rounded-sm"></span>
                  <span>Roll Margins (10mm sides)</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 bg-indigo-400 rounded-sm"></span>
                  <span>Prepress Margins (25mm top/bottom)</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 border border-pink-500 rounded-sm"></span>
                  <span>Zünd Cut Contours</span>
                </span>
              </div>
              {uploadedFiles.length > 0 && (
                <span className="text-zinc-700 font-bold whitespace-nowrap">
                  Height: {activeSheet.croppedHeight} mm
                </span>
              )}
            </div>

          </div>

        </main>

      </div>

      {/* Styled inline style overrides to handle technical grids cleanly */}
      <style>{`
        .grid-bg {
          background-image: radial-gradient(circle, #a1a1aa 1px, transparent 1px);
          background-size: 16px 16px;
        }
        .grid-bg-blue {
          background-image: radial-gradient(circle, #3b82f6 1.5px, transparent 1.5px);
          background-size: 8px 8px;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.15s ease-out forwards;
        }
      `}</style>

      {/* Custom non-blocking Alert and Confirm dialog overlay */}
      {dialog.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn" id="custom-dialog-overlay">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-zinc-200/80 overflow-hidden transform transition-all animate-fadeIn" id="custom-dialog-container">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center space-x-3 bg-zinc-50">
              <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <h3 className="text-xs uppercase font-bold tracking-wider text-zinc-800 font-sans">
                {dialog.title}
              </h3>
            </div>
            
            {/* Content */}
            <div className="px-5 py-5">
              <p className="text-xs text-zinc-600 leading-relaxed whitespace-pre-line font-medium">
                {dialog.message}
              </p>
            </div>
            
            {/* Actions */}
            <div className="px-5 py-3.5 bg-zinc-50 border-t border-zinc-100 flex justify-end space-x-2">
              {dialog.type === 'confirm' ? (
                <>
                  <button
                    type="button"
                    onClick={dialog.onCancel}
                    className="px-3.5 py-1.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 transition"
                  >
                    Annuleren / Cancel
                  </button>
                  <button
                    type="button"
                    onClick={dialog.onConfirm}
                    className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                  >
                    Ja, Verwijderen / Yes, Delete
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={dialog.onConfirm}
                  className="px-4 py-1.5 bg-zinc-950 hover:bg-zinc-800 active:bg-black text-white rounded-lg text-xs font-semibold shadow-xs transition"
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
