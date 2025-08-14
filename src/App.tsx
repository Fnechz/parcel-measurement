import React, { useEffect, useMemo, useRef, useState, useId } from "react";

/**
 * PARCEL MEASUREMENT APP (NO‑AR)
 * Single‑file React + TypeScript demo that supports:
 * 1) Screen calibration via a real credit card on the display (like your sandbox).
 * 2) Measurement from a photo using an in‑image calibration line (recommended for parcels).
 *    - Upload a photo
 *    - Draw a calibration line and enter its real length (e.g., a known ruler/credit card in the photo)
 *    - Draw/resize a rectangle over the parcel top face to read out width/height + area
 *
 * This file is designed to run in a standard React toolchain (Vite/Cra/CodeSandbox).
 * No external UI libs are required. Pointer events are used for touch+mouse.
 */

// ---- Constants (credit card dimensions per ISO/IEC 7810 ID‑1) ----
const CREDIT_CARD_WIDTH_MM = 85.60; // width

// SVG design size used for on‑screen credit card (like your example)
const CARD_SVG_PX = { w: 389, h: 246 };

// Locker sizes (depth is fixed at 500mm)
const LOCKER_SIZES = {
  small: { length: 385, width: 500, height: 110.2, label: "SMALL" },
  medium: { length: 385, width: 500, height: 222.2, label: "MEDIUM" },
  large: { length: 385, width: 500, height: 301, label: "LARGE" },
} as const;

// Utility types
interface Pt { x: number; y: number }

// ---- Helpers ----
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function dist(a: Pt, b: Pt) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }
function fmt(n: number, digits = 1) { return Number.isFinite(n) ? n.toFixed(digits) : "-"; }

// Convert px/mm on *screen* from the calibration card scale
function pxPerMMFromScreenScale(scale: number) {
  return (CARD_SVG_PX.w * scale) / CREDIT_CARD_WIDTH_MM; // px per mm on this screen
}

// ---- Onboarding overlay ----
function Onboarding({ open, onClose, onReplayPhoto }: { open:boolean; onClose:()=>void; onReplayPhoto: ()=>void }){
  const [step, setStep] = useState(0);
  const steps = [
    { title: "Welcome", body: "This app measures parcels using two photos: top view for length/width and side view for height." },
    { title: "Top view", body: "Upload or capture a top‑down photo. Drag the blue calibration line over a known object (credit card/ruler), then fit the rectangle around the parcel surface." },
    { title: "Side view", body: "Upload or capture a side photo. Drag the blue line to calibrate, then drag the amber line to match the parcel height." },
    { title: "Locker match", body: "The app recommends SMALL/MEDIUM/LARGE based on the measured dimensions." },
    { title: "Tips", body: "Keep the phone parallel to the surface, avoid perspective, and use the magnifier for precise placement." },
  ];
  if (!open) return null as any;
  return (
    <div className="tourOverlay" role="dialog" aria-modal>
      <div className="tourCard">
        <div className="tourHeader">
          <h3>{steps[step].title}</h3>
          <button className="tourX" onClick={()=>{ localStorage.setItem('tour_done','1'); onClose(); }} aria-label="Close">✕</button>
        </div>
        <p>{steps[step].body}</p>
        <div className="tourActions">
          <button onClick={()=>{ localStorage.setItem('tour_done','1'); onClose(); }}>Skip</button>
          <div className="spacer" />
          {step>0 && <button onClick={()=>setStep(step-1)}>Back</button>}
          {step<steps.length-1 ? (
            <button className="cta" onClick={()=>setStep(step+1)}>Next</button>
          ) : (
            <>
              <button onClick={()=>{ onReplayPhoto(); setStep(0); }}>Watch demo</button>
              <button className="cta" onClick={()=>{ localStorage.setItem('tour_done','1'); onClose(); }}>Start</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Demo animation overlay (non-interactive) ----
function DemoOverlay({ show, onClose }: { show:boolean; onClose:()=>void }){
  if (!show) return null as any;
  return (
    <div className="demoOverlay" onClick={onClose}>
      <div className="demoCard">
        <h3>How to measure</h3>
        <ol>
          <li>Drag the blue line over a known length to calibrate.</li>
          <li>Fit the thin rectangle around the parcel top face.</li>
          <li>Switch to side view and drag the amber line to match height.</li>
        </ol>
        <p className="muted">Tap anywhere to close</p>
      </div>
      <svg className="demoAnim" viewBox="0 0 600 360" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <rect x="40" y="80" width="520" height="200" className="demoRect" />
        <g className="demoCal">
          <line x1="120" y1="60" x2="480" y2="60" />
          <circle cx="120" cy="60" r="10" />
          <circle cx="480" cy="60" r="10" />
        </g>
        <g className="demoHand">
          <circle cx="0" cy="0" r="10" />
        </g>
      </svg>
    </div>
  );
}

// ---- Round-shaped draggable handle (for line endpoints - mobile friendly) ----
function RoundHandle({ x, y, onDrag, onDragStart, onDragEnd, onDragMove }: { x: number, y: number, onDrag: (p: Pt) => void, onDragStart?: (p: Pt) => void, onDragEnd?: () => void, onDragMove?: (p: Pt)=>void }) {
  const downRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<Pt | null>(null);
  const getLocal = (e: React.PointerEvent) => {
    const node = e.currentTarget as any;
    const svg: SVGSVGElement = (node.ownerSVGElement || node) as SVGSVGElement;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    const res = ctm ? pt.matrixTransform(ctm.inverse()) : { x: e.clientX, y: e.clientY } as any;
    return { x: res.x, y: res.y } as Pt;
  };
  const flush = () => {
    rafRef.current = null;
    if (pendingRef.current) {
      const p = pendingRef.current;
      onDrag(p);
      onDragMove?.(p);
      pendingRef.current = null;
    }
  };
  const onDown = (e: React.PointerEvent) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); downRef.current = true; const p=getLocal(e); onDragStart?.(p); };
  const onMove = (e: React.PointerEvent) => { if (!downRef.current) return; pendingRef.current = getLocal(e); if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush); };
  const onUp = () => { downRef.current = false; if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } onDragEnd?.(); };
  return (
    <g onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <circle cx={x} cy={y} r={100} className="handleHit" />
      <circle cx={x} cy={y} r={50} className="handleCircle" />
      <circle cx={x} cy={y} r={20} className="handleInner" />
    </g>
  );
}

// Corner circular handle (for rectangle corners)
function CornerHandle({ x, y, onDrag, onDragStart, onDragEnd }: { x: number, y: number, onDrag: (p: Pt) => void, onDragStart?: (p: Pt) => void, onDragEnd?: () => void }){
  const downRef = useRef(false);
  const getLocal = (e: React.PointerEvent) => {
    const node = e.currentTarget as any;
    const svg: SVGSVGElement = (node.ownerSVGElement || node) as SVGSVGElement;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    const res = ctm ? pt.matrixTransform(ctm.inverse()) : { x: e.clientX, y: e.clientY } as any;
    return { x: res.x, y: res.y } as Pt;
  };
  const onDown = (e: React.PointerEvent) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); downRef.current = true; onDragStart?.(getLocal(e)); };
  const onMove = (e: React.PointerEvent) => { if (!downRef.current) return; onDrag(getLocal(e)); };
  const onUp = () => { downRef.current = false; onDragEnd?.(); };
  return (
    <g onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <circle cx={x} cy={y} r={100} className="handleHit" />
      <circle cx={x} cy={y} r={50} className="cornerCircle" />
      <circle cx={x} cy={y} r={20} className="handleInner" />
    </g>
  );
}

// ---- Rect with 4 corner handles ----
function DraggableRect({ rect, onChange, onDragStart, onDragEnd, onDragMove, bounds }: { rect: { x: number; y: number; w: number; h: number }, onChange: (r: { x: number; y: number; w: number; h: number }) => void, onDragStart?: (p: Pt) => void, onDragEnd?: () => void, onDragMove?: (p: Pt)=>void, bounds?: { w:number; h:number } }) {
  const { x, y, w, h } = rect;
  const bodyDown = useRef(false);
  const dragOrigin = useRef<Pt>({ x:0, y:0 });
  const rectOrigin = useRef<{x:number;y:number}>({ x, y });
  const getLocal = (e: React.PointerEvent) => {
    const node = e.currentTarget as any;
    const svg: SVGSVGElement = (node.ownerSVGElement || node) as SVGSVGElement;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    const res = ctm ? pt.matrixTransform(ctm.inverse()) : { x: e.clientX, y: e.clientY } as any;
    return { x: res.x, y: res.y } as Pt;
  };
  const setCorner = (ix: 0|1, iy: 0|1, p: Pt) => {
    const nx = ix === 0 ? Math.min(p.x, x + w) : Math.max(p.x, x);
    const ny = iy === 0 ? Math.min(p.y, y + h) : Math.max(p.y, y);
    const left = ix === 0 ? nx : x;
    const top  = iy === 0 ? ny : y;
    const right = ix === 0 ? x + w : nx;
    const bottom = iy === 0 ? y + h : ny;
    onChange({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const onBodyDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    bodyDown.current = true;
    const pt = getLocal(e);
    dragOrigin.current = pt;
    rectOrigin.current = { x, y };
    onDragStart?.(pt);
  };
  const onBodyMove = (e: React.PointerEvent) => {
    if (!bodyDown.current) return;
    const pt = getLocal(e);
    const dx = pt.x - dragOrigin.current.x;
    const dy = pt.y - dragOrigin.current.y;
    let nx = rectOrigin.current.x + dx;
    let ny = rectOrigin.current.y + dy;
    if (bounds) {
      nx = clamp(nx, 0, Math.max(0, bounds.w - w));
      ny = clamp(ny, 0, Math.max(0, bounds.h - h));
    }
    onChange({ x: nx, y: ny, w, h });
    onDragMove?.({ x: nx + w, y: ny + h });
  };
  const onBodyUp = () => { bodyDown.current = false; onDragEnd?.(); };

  return (
    <g>
      {/* halo first then visible rect */}
      <rect x={x} y={y} width={w} height={h} className="rectHalo" />
      <rect x={x} y={y} width={w} height={h} className="rect" onPointerDown={onBodyDown} onPointerMove={onBodyMove} onPointerUp={onBodyUp} />
      {/* corners: tl, tr, br, bl */}
      <CornerHandle x={x}       y={y}       onDrag={(p)=>setCorner(0,0,p)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <CornerHandle x={x+w}     y={y}       onDrag={(p)=>setCorner(1,0,p)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <CornerHandle x={x+w}     y={y+h}     onDrag={(p)=>setCorner(1,1,p)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <CornerHandle x={x}       y={y+h}     onDrag={(p)=>setCorner(0,1,p)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
    </g>
  );
}

// ---- Calibration/Measure line (two handles) ----
function CalibrationLine({ a, b, onChange, variant = 'cal', onDragStart, onDragEnd, onDragMove }: { a: Pt; b: Pt; onChange: (a: Pt, b: Pt) => void, variant?: 'cal'|'measure', onDragStart?: (p: Pt)=>void, onDragEnd?: ()=>void, onDragMove?: (p: Pt)=>void }) {
  return (
    <g>
      {/* halo first then colored line */}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="lineHalo" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={variant==='cal' ? 'calLine' : 'measureLine'} />
      <RoundHandle x={a.x} y={a.y} onDrag={(p)=>onChange(p, b)} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragMove={onDragMove} />
      <RoundHandle x={b.x} y={b.y} onDrag={(p)=>onChange(a, p)} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragMove={onDragMove} />
    </g>
  );
}

// ---- SVG Magnifier helper ----
function SVGMagnifier({ show, x, y, imgURL, imgSize, scale=2.5, r=60, id }: { show:boolean; x:number; y:number; imgURL:string; imgSize:{w:number;h:number}; scale?:number; r?:number; id:string }){
  if (!show) return null as any;
  const mx = clamp(x + r + 12, r+12, (imgSize.w - r - 12));
  const my = clamp(y - r - 12, r+12, (imgSize.h - r - 12));
  return (
    <g className="magnifier" pointerEvents="none">
      <defs>
        <clipPath id={id}><circle cx={mx} cy={my} r={r} /></clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <image href={imgURL} x={0} y={0} width={imgSize.w} height={imgSize.h} transform={`translate(${(mx) - scale*x}, ${(my) - scale*y}) scale(${scale})`} />
      </g>
      <circle cx={mx} cy={my} r={r} className="magBorder" />
      <line x1={mx-r} y1={my} x2={mx+r} y2={my} className="magCross" />
      <line x1={mx} y1={my-r} x2={mx} y2={my+r} className="magCross" />
    </g>
  );
}

// ---- Section: Screen Calibration (credit‑card against screen) ----
function ScreenCalibration() {
  const [scale, setScale] = useState<number>(()=>{
    const last = localStorage.getItem("card_scale");
    return last ? Number(last) : 1;
  });
  useEffect(()=>{ localStorage.setItem("card_scale", String(scale)); }, [scale]);

  // derived
  const pxPerMM = useMemo(()=>pxPerMMFromScreenScale(scale), [scale]);
  const ppi = useMemo(()=> (pxPerMM * 25.4) * window.devicePixelRatio, [pxPerMM]);
  const ppm = useMemo(()=> ppi / 0.0254, [ppi]);

  const onDragResize = (clientX: number) => {
    const distanceFromMiddle = Math.abs(clientX - window.innerWidth / 2);
    const newScale = clamp((distanceFromMiddle / CARD_SVG_PX.w) * 2.0, 0.2, 6);
    setScale(newScale);
  };

  const downRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => { downRef.current = true; onDragResize(e.clientX); };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => { if (downRef.current) onDragResize(e.clientX); };
  const onPointerUp   = () => { downRef.current = false; };

  return (
    <div className="panel">
      <h2>Calibrate your screen</h2>
      <p>Place a real credit card against the screen and drag the handles until the on‑screen card matches. Then we can compute your display PPI.</p>

      <div className="cardRow" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <div className="resizer" style={{ transform: `scale(${scale})` }} />
        <div className="card" style={{ width: CARD_SVG_PX.w*scale, height: CARD_SVG_PX.h*scale }} />
        <div className="resizer" style={{ transform: `scale(${scale})` }} />
      </div>

      <div className="stats">
        <div><b>PPI</b><span>{Math.round(ppi)}</span></div>
        <div><b>PPM</b><span>{fmt(ppm,1)}</span></div>
        <div><b>devicePixelRatio</b><span>{window.devicePixelRatio}</span></div>
        <div><b>Card mm(px)</b><span>{fmt(pxPerMM,2)} px/mm</span></div>
      </div>
    </div>
  );
}

// ---- Section: Measure From Photo (parcel top face + height from side) ----
function PhotoMeasure() {
  const magTopId = useId();
  const magSideId = useId();

  type ImgSize = { w:number; h:number };
  type Rect = { x:number; y:number; w:number; h:number };

  const [step, setStep] = useState<'top'|'side'>("top");
  const [showDemo, setShowDemo] = useState(false);

  // Top View (length/width)
  const [topImgURL, setTopImgURL] = useState<string | null>(null);
  const [topImgSize, setTopImgSize] = useState<ImgSize>({ w:0, h:0 });
  const [topCalA, setTopCalA] = useState<Pt>({ x: 80, y: 80 });
  const [topCalB, setTopCalB] = useState<Pt>({ x: 260, y: 80 });
  const [topCalReal, setTopCalReal] = useState<number>(CREDIT_CARD_WIDTH_MM);
  const [topRect, setTopRect] = useState<Rect>({ x: 120, y: 120, w: 220, h: 160 });
  const [showMagTop, setShowMagTop] = useState(false);
  const [magTopPt, setMagTopPt] = useState<Pt>({ x: 0, y: 0 });
  const [topPlaced, setTopPlaced] = useState(false);

  // Side View (height)
  const [sideImgURL, setSideImgURL] = useState<string | null>(null);
  const [sideImgSize, setSideImgSize] = useState<ImgSize>({ w:0, h:0 });
  const [sideCalA, setSideCalA] = useState<Pt>({ x: 80, y: 80 });
  const [sideCalB, setSideCalB] = useState<Pt>({ x: 260, y: 80 });
  const [sideCalReal, setSideCalReal] = useState<number>(CREDIT_CARD_WIDTH_MM);
  const [sideHeightA, setSideHeightA] = useState<Pt>({ x: 180, y: 120 });
  const [sideHeightB, setSideHeightB] = useState<Pt>({ x: 180, y: 260 });
  const [showMagSide, setShowMagSide] = useState(false);
  const [magSidePt, setMagSidePt] = useState<Pt>({ x: 0, y: 0 });
  const [sidePlaced, setSidePlaced] = useState(false);

  const readNaturalSize = (url: string): Promise<ImgSize> => new Promise((resolve)=>{
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  });
  const onTopFile = async (f: File) => {
    const url = URL.createObjectURL(f);
    setTopImgURL(url);
    const sz = await readNaturalSize(url);
    setTopImgSize(sz);
    setTopPlaced(false);
  };
  const onSideFile = async (f: File) => {
    const url = URL.createObjectURL(f);
    setSideImgURL(url);
    const sz = await readNaturalSize(url);
    setSideImgSize(sz);
    setSidePlaced(false);
  };

  const topPxPerMM = useMemo(()=>{
    const dpx = dist(topCalA, topCalB);
    return dpx > 0 && topCalReal > 0 ? (dpx / topCalReal) : 0;
  }, [topCalA, topCalB, topCalReal]);

  const sidePxPerMM = useMemo(()=>{
    const dpx = dist(sideCalA, sideCalB);
    return dpx > 0 && sideCalReal > 0 ? (dpx / sideCalReal) : 0;
  }, [sideCalA, sideCalB, sideCalReal]);

  // Derived measurements (mm)
  const topWmm = topRect.w / (topPxPerMM || 1);
  const topHmm = topRect.h / (topPxPerMM || 1);
  const lengthMM = Math.max(topWmm, topHmm);
  const widthMM  = Math.min(topWmm, topHmm);
  const areaCM2  = (lengthMM * widthMM) / 100;

  const heightMM = dist(sideHeightA, sideHeightB) / (sidePxPerMM || 1);

  // Locker recommendation
  type LockerKey = keyof typeof LOCKER_SIZES;
  type RecommendResult = { label: string; color: string; sizeKey: LockerKey | null };
  function recommendLocker(lenMM: number, widMM: number, htMM: number): RecommendResult {
    // Orientation allowed: footprint must satisfy min<=385 and max<=500
    const a = Math.min(lenMM, widMM);
    const b = Math.max(lenMM, widMM);
    const footprintFits = a <= LOCKER_SIZES.small.length && b <= LOCKER_SIZES.small.width;

    if (!footprintFits) return { label: "Too large for footprint", color: "#ff6b6b", sizeKey: null };

    const ordered = ["small", "medium", "large"] as const;
    for (const key of ordered) {
      const spec = LOCKER_SIZES[key];
      if (htMM <= spec.height) return { label: spec.label, color: "#36d399", sizeKey: key };
    }
    return { label: "Height exceeds LARGE", color: "#ffb020", sizeKey: null };
  }

  const rec = recommendLocker(lengthMM, widthMM, heightMM);

  const stepDoneTop  = Number.isFinite(lengthMM) && Number.isFinite(widthMM) && (lengthMM>0) && (widthMM>0) && !!topImgURL;
  const stepDoneSide = Number.isFinite(heightMM)   && (heightMM>0) && !!sideImgURL;

  // Center-initialize tools when image size becomes known
  useEffect(() => {
    if (topImgURL && topImgSize.w > 0 && topImgSize.h > 0 && !topPlaced) {
      const cx = topImgSize.w / 2, cy = topImgSize.h / 2;
      const len = Math.min(topImgSize.w, topImgSize.h) * 0.3;
      setTopCalA({ x: cx - len/2, y: cy });
      setTopCalB({ x: cx + len/2, y: cy });
      const rw = topImgSize.w * 0.45, rh = topImgSize.h * 0.35;
      setTopRect({ x: cx - rw/2, y: cy - rh/2, w: rw, h: rh });
      setTopPlaced(true);
    }
  }, [topImgURL, topImgSize, topPlaced]);

  useEffect(() => {
    if (sideImgURL && sideImgSize.w > 0 && sideImgSize.h > 0 && !sidePlaced) {
      const cx = sideImgSize.w / 2, cy = sideImgSize.h / 2;
      const len = Math.min(sideImgSize.w, sideImgSize.h) * 0.3;
      setSideCalA({ x: cx - len/2, y: cy });
      setSideCalB({ x: cx + len/2, y: cy });
      setSideHeightA({ x: cx, y: cy - len/2 });
      setSideHeightB({ x: cx, y: cy + len/2 });
      setSidePlaced(true);
    }
  }, [sideImgURL, sideImgSize, sidePlaced]);

  return (
    <div className="panel">
      <DemoOverlay show={showDemo} onClose={()=>setShowDemo(false)} />
      <div className="stepper">
        <button className={step==='top' ? 'active' : ''} onClick={()=>setStep('top')}>1. Top View</button>
        <button className={step==='side' ? 'active' : ''} onClick={()=>setStep('side')} disabled={!stepDoneTop}>2. Side View</button>
        <div className="spacer" />
        <button onClick={()=>setShowDemo(true)}>Watch demo</button>
        <button className="cta" onClick={()=>setStep('side')} disabled={!stepDoneTop}>Next</button>
      </div>

      {step === 'top' && (
        <>
          <h2>Top view: length × width</h2>
          <p>Take or upload a top‑down photo with a known object (credit card or ruler), drag the calibration line over it, then fit the rectangle around the parcel’s top face.</p>

      <div className="controls">
        <label className="file">
              <input type="file" accept="image/*" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onTopFile(f); }} />
          <span>Upload photo…</span>
        </label>
            <label className="file cameraBtn">
              <input type="file" accept="image/*" capture="environment" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onTopFile(f); }} />
              <span>Use camera</span>
            </label>
        <label>
          Ref length (mm)
              <input type="number" value={topCalReal} min={1} step={0.1} onChange={(e)=>setTopCalReal(Number(e.target.value))} />
            </label>
            <div className="hint">Tip: Align your phone parallel to the parcel to reduce perspective distortion.</div>
          </div>

          <div className="canvasWrap">
            {topImgURL ? (
              <svg className="stage" viewBox={`0 0 ${(topImgSize.w||800)} ${(topImgSize.h||500)}`} preserveAspectRatio="xMidYMid meet">
                <image href={topImgURL} x={0} y={0} width={topImgSize.w||800} height={topImgSize.h||500} preserveAspectRatio="xMidYMid slice" />
                <CalibrationLine a={topCalA} b={topCalB} onChange={(a,b)=>{ setTopCalA(a); setTopCalB(b); }} onDragStart={(p)=>{ setShowMagTop(true); setMagTopPt(p); }} onDragMove={(p)=>setMagTopPt(p)} onDragEnd={()=>setShowMagTop(false)} />
                <DraggableRect rect={topRect} onChange={(r)=>{ setTopRect(r); }} onDragStart={(p)=>{ setShowMagTop(true); setMagTopPt(p); }} onDragEnd={()=>setShowMagTop(false)} bounds={topImgSize} />
                {/* Magnifier overlay */}
                {showMagTop && topImgURL && (
                  <SVGMagnifier show={showMagTop} x={magTopPt.x} y={magTopPt.y} imgURL={topImgURL} imgSize={topImgSize} scale={3} r={64} id={`mag${magTopId}`} />
                )}
              </svg>
            ) : (
              <div className="placeholder">Upload or capture a top‑down photo to begin</div>
            )}
          </div>

          <div className="stats">
            <div><b>px per mm (image)</b><span>{fmt(topPxPerMM,2)}</span></div>
            <div><b>Length</b><span>{fmt(lengthMM,1)} mm ({fmt(lengthMM/10,1)} cm)</span></div>
            <div><b>Width</b><span>{fmt(widthMM,1)} mm ({fmt(widthMM/10,1)} cm)</span></div>
            <div><b>Area</b><span>{fmt(areaCM2,1)} cm²</span></div>
          </div>
        </>
      )}

      {step === 'side' && (
        <>
          <h2>Side view: height</h2>
          <p>Take or upload a side photo with a known object. Drag the calibration line over the reference, then drag the measurement line to match the parcel’s height.</p>
          <div className="legend">
            <span className="swatch cal" /> Calibration (known length)
            <span className="spacer" />
            <span className="swatch meas" /> Height measurement
          </div>

          <div className="controls">
            <label className="file">
              <input type="file" accept="image/*" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onSideFile(f); }} />
              <span>Upload photo…</span>
            </label>
            <label className="file cameraBtn">
              <input type="file" accept="image/*" capture="environment" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onSideFile(f); }} />
              <span>Use camera</span>
        </label>
        <label>
              Ref length (mm)
              <input type="number" value={sideCalReal} min={1} step={0.1} onChange={(e)=>setSideCalReal(Number(e.target.value))} />
        </label>
            <div className="hint">Tip: Keep the phone level; ensure the box edge is vertical in the frame.</div>
      </div>

      <div className="canvasWrap">
            {sideImgURL ? (
              <svg className="stage" viewBox={`0 0 ${sideImgSize.w||800} ${sideImgSize.h||500}`} preserveAspectRatio="xMidYMid meet">
                <image href={sideImgURL} x={0} y={0} width={sideImgSize.w||800} height={sideImgSize.h||500} preserveAspectRatio="xMidYMid slice" />
                {/* Calibration line (side view) */}
                <CalibrationLine a={sideCalA} b={sideCalB} onChange={(a,b)=>{ setSideCalA(a); setSideCalB(b); }} variant="cal" onDragStart={(p)=>{ setShowMagSide(true); setMagSidePt(p); }} onDragMove={(p)=>setMagSidePt(p)} onDragEnd={()=>setShowMagSide(false)} />
                {/* Height measurement line */}
                <CalibrationLine a={sideHeightA} b={sideHeightB} onChange={(a,b)=>{ setSideHeightA(a); setSideHeightB(b); }} variant="measure" onDragStart={(p)=>{ setShowMagSide(true); setMagSidePt(p); }} onDragMove={(p)=>setMagSidePt(p)} onDragEnd={()=>setShowMagSide(false)} />
                {/* Magnifier overlay */}
                {showMagSide && sideImgURL && (
                  <SVGMagnifier show={showMagSide} x={magSidePt.x} y={magSidePt.y} imgURL={sideImgURL} imgSize={sideImgSize} scale={3} r={64} id={`mag${magSideId}`} />
                )}
          </svg>
        ) : (
              <div className="placeholder">Upload or capture a side photo to measure height</div>
        )}
      </div>

      <div className="stats">
            <div><b>px per mm (image)</b><span>{fmt(sidePxPerMM,2)}</span></div>
        <div><b>Height</b><span>{fmt(heightMM,1)} mm ({fmt(heightMM/10,1)} cm)</span></div>
          </div>

          {(stepDoneTop && stepDoneSide) && (
            <div className="result" style={{ borderColor: rec.color }}>
              <div className="row">
                <span className="badge" style={{ background: rec.color }}>{rec.label}</span>
                <span className="muted">Locker fit recommendation</span>
              </div>
              <div className="dims">
                <div><b>Footprint</b><span>{fmt(Math.min(lengthMM,widthMM),1)} × {fmt(Math.max(lengthMM,widthMM),1)} mm (fits ≤ 385 × 500 mm with rotation)</span></div>
                <div><b>Height</b><span>{fmt(heightMM,1)} mm</span></div>
              </div>
            </div>
          )}

          <div className="stepper">
            <button onClick={()=>setStep('top')}>Back</button>
            <div className="spacer" />
            <button className="cta" disabled={!(stepDoneTop && stepDoneSide)} onClick={()=>window.scrollTo({ top: 0, behavior: 'smooth' })}>Done</button>
      </div>
        </>
      )}
    </div>
  );
}

// ---- Main App (tabs) ----
export default function App() {
  const [tab, setTab] = useState<'photo'|'screen'>("photo");
  const [tourOpen, setTourOpen] = useState(()=> localStorage.getItem('tour_done') !== '1');

  return (
    <div className="app">
      <style>{css}</style>
      <header>
        <h1>Parcel Measure (Camera‑ready)</h1>
        <nav>
          <button className={tab==='photo'? 'active':''} onClick={()=>setTab('photo')}>Measure from Photo</button>
          <button className={tab==='screen'? 'active':''} onClick={()=>setTab('screen')}>Calibrate Screen</button>
          <button onClick={()=>{ localStorage.removeItem('tour_done'); setTourOpen(true); }}>Replay Tutorial</button>
        </nav>
      </header>
      <Onboarding open={tourOpen} onClose={()=>setTourOpen(false)} onReplayPhoto={()=>{ setTab('photo'); setTourOpen(false); }} />
      {tab === 'photo' ? <PhotoMeasure/> : <ScreenCalibration/>}
      <footer>
        <p>
          Tip: Credit card dimensions follow ISO/IEC 7810 ID‑1 (85.60 × 53.98 mm). Use a card or a ruler in the photo as your reference.
        </p>
      </footer>
    </div>
  );
}

// ---- minimal CSS injected as a string for single‑file demo ----
const css = `
:root{ --bg:#0b1020; --card:#131a33; --ink:#e9eefb; --muted:#9db1ff; --accent:#6ea8fe; --good:#36d399; --line:#2ee8ff; --amber:#ffd166; }
*{ box-sizing:border-box; } body{ margin:0; background:var(--bg); color:var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji; }
.app{ max-width:1000px; margin:0 auto; padding:16px; }
header{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; }
h1{ font-size:20px; margin:0; }
nav{ display:flex; gap:8px; flex-wrap:wrap; }
nav button{ background:transparent; border:1px solid var(--accent); color:var(--ink); padding:8px 12px; border-radius:12px; cursor:pointer; }
nav button.active{ background:var(--accent); color:#0b1020; }
.panel{ background:var(--card); padding:16px; border-radius:16px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
.panel h2{ margin:0 0 8px; font-size:18px; }
.panel p{ color:var(--muted); margin:0 0 12px; }

/* Onboarding modal */
.tourOverlay{ position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; z-index:50; }
.tourCard{ background:#10173a; border:1px solid #2b3766; border-radius:16px; padding:16px; width:min(520px, 92vw); color:var(--ink); box-shadow:0 20px 60px rgba(0,0,0,.45); }
.tourHeader{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.tourHeader h3{ margin:0; font-size:18px; }
.tourX{ background:transparent; border:0; color:#bcd1ff; cursor:pointer; font-size:18px; }
.tourActions{ display:flex; align-items:center; gap:8px; margin-top:12px; }
.tourActions .spacer{ flex:1; }
.tourActions button{ background:#0f1733; border:1px solid #2b3766; color:var(--ink); padding:8px 12px; border-radius:10px; cursor:pointer; }
.tourActions .cta{ background:linear-gradient(180deg, #7aa2f7, #6ea8fe); color:#0b1020; border:none; }

/* Demo overlay */
.demoOverlay{ position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:40; }
.demoCard{ background:#0e1533; border:1px solid #2b3766; color:var(--ink); border-radius:14px; padding:12px 16px; margin-bottom:12px; width:min(560px, 92vw); }
.demoAnim{ width:min(560px, 92vw); height:auto; border-radius:12px; background:#0b112e; }
.demoRect{ fill:none; stroke:#7aa2f7; stroke-width:2; }
.demoCal line{ stroke:var(--line); stroke-width:2; stroke-dasharray:12 8; }
.demoCal circle{ fill:#2ee8ff; }
.demoHand{ animation: handMove 2.4s ease-in-out infinite; }
.demoHand circle{ fill:#fff; }
@keyframes handMove{ 0%{ transform: translate(120px,60px);} 50%{ transform: translate(480px,60px);} 100%{ transform: translate(120px,60px);} }

/* Stepper */
.stepper{ display:flex; align-items:center; gap:8px; margin-bottom:12px; }
.stepper .spacer{ flex:1; }
.stepper button{ background:#0f1733; border:1px solid #2b3766; color:var(--ink); padding:8px 12px; border-radius:10px; cursor:pointer; }
.stepper button.active{ background:var(--accent); color:#0b1020; border-color:var(--accent); }
.stepper .cta{ background:linear-gradient(180deg, #7aa2f7, #6ea8fe); color:#0b1020; border:none; }
.stepper button:disabled{ opacity:.5; cursor:not-allowed; }

/* Screen calibration card row */
.cardRow{ display:flex; align-items:center; justify-content:center; gap:8px; padding:16px; user-select:none; }
.resizer{ width:16px; height:80px; border-radius:12px; background:linear-gradient(180deg, #7aa2f7, #6ea8fe); box-shadow: 0 6px 20px rgba(110,168,254,.4); }
.card{ background:#ff715b; border-radius:12px; }

/* Photo canvas */
.canvasWrap{ background:#0f1733; border-radius:12px; min-height:280px; display:flex; align-items:center; justify-content:center; overflow:hidden; padding:8px; }
.stage{ width:100%; height:auto; display:block; border-radius:12px; max-height:78vh; touch-action:none; user-select:none; }
@media (max-width: 600px){ .stage{ max-height: 88vh; } }
.placeholder{ color:var(--muted); padding:60px; }

/* SVG styling */
.rect{ fill: none; stroke: var(--accent); stroke-width: 2; cursor: move; vector-effect: non-scaling-stroke; }
.rectHalo{ display: none; }
.calLine{ stroke: var(--line); stroke-width: 2; stroke-dasharray: 12 8; vector-effect: non-scaling-stroke; }
.measureLine{ stroke: var(--amber); stroke-width: 2; vector-effect: non-scaling-stroke; }
.lineHalo{ display: none; }
.handle{ fill:#fff; stroke: var(--accent); stroke-width:2; r:12; }
.handleCircle, .cornerCircle { 
  fill: transparent; 
  stroke: transparent; 
}
.handleInner {
  fill: var(--accent);
  stroke: white;
  stroke-width: 1.5;
}
.handleCross line{ stroke: var(--accent); stroke-width: 2.5; }
.handleCross{ cursor: pointer; }
.handleHit{ fill: transparent; stroke: transparent; pointer-events: all; }

.magnifier .magBorder{ fill: rgba(15,23,51,0.6); stroke: #bcd1ff; stroke-width: 2; }
.magnifier .magCross{ stroke: rgba(255,255,255,0.85); stroke-width: 1.5; stroke-dasharray: 4 4; }

.controls{ display:flex; gap:12px; flex-wrap:wrap; align-items:end; margin-bottom:12px; }
.controls label{ display:flex; flex-direction:column; gap:6px; font-size:14px; color:var(--ink); }
.controls input[type='number']{ width:140px; padding:8px; border-radius:8px; border:1px solid #2f3a66; background:#0c1330; color:var(--ink); }
.controls .file{ position:relative; overflow:hidden; }
.controls .file input{ position:absolute; inset:0; opacity:0; cursor:pointer; }
.controls .file span{ display:inline-block; padding:8px 12px; border:1px dashed #4b5a93; border-radius:10px; color:var(--ink); }
.controls .cameraBtn span{ border-style:solid; }
.controls .hint{ color:#90a7ff; font-size:12px; }

.legend{ display:flex; align-items:center; gap:10px; color:#bcd1ff; font-size:13px; margin:6px 0 10px; }
.legend .swatch{ width:26px; height:0; border-top-width:3px; border-top-style:solid; display:inline-block; }
.legend .swatch.cal{ border-top-color: var(--line); border-top-style: dashed; }
.legend .swatch.meas{ border-top-color: var(--amber); }
.legend .spacer{ flex:1; }

.stats{ display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:8px; margin-top:12px; }
.stats > div{ background:#0f1733; border:1px solid #1b2550; padding:10px 12px; border-radius:12px; display:flex; align-items:center; justify-content:space-between; }
.stats b{ color:#bcd1ff; font-weight:600; }

.result{ border:1px solid var(--good); border-radius:14px; padding:12px; margin-top:12px; background: rgba(54,211,153,0.08); }
.result .row{ display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.badge{ color:#0b1020; font-weight:700; padding:4px 10px; border-radius:999px; }
.result .muted{ color:#9db1ff; }
.result .dims{ display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:8px; }

footer{ color:#bcd1ff; opacity:.85; margin-top:12px; font-size:12px; }
`;
