import type { CSSProperties, ReactElement } from 'react';
import './signalField.css';

type TraceLayer = 'far' | 'mid' | 'near';
type GateKind = 'and' | 'or' | 'not';

type Trace = {
  id: string;
  layer: TraceLayer;
  d: string;
  pulse?: {
    delay: number;
    duration: number;
  };
};

type Node = {
  id: string;
  layer: TraceLayer;
  x: number;
  y: number;
  hot?: boolean;
};

type GateGlyph = {
  id: string;
  kind: GateKind;
  x: number;
  y: number;
  scale: number;
  rotate: number;
};

type SignalStyle = CSSProperties & {
  '--signal-delay': string;
  '--signal-duration': string;
};

const TRACES: readonly Trace[] = [
  { id: 'f01', layer: 'far', d: 'M-40 88 H168 V152 H344 V92 H526 V214 H742 V144 H980' },
  { id: 'f02', layer: 'far', d: 'M108 690 H294 V618 H492 V702 H756 V626 H1044 V706 H1480' },
  { id: 'f03', layer: 'far', d: 'M76 294 H236 V366 H424 V310 H612 V382 H792 V296 H1030' },
  { id: 'f04', layer: 'far', d: 'M1188 -20 V132 H1094 V302 H1196 V486 H1110 V720' },
  { id: 'f05', layer: 'far', d: 'M326 -20 V106 H408 V258 H334 V458 H426 V636 H342 V920' },
  { id: 'f06', layer: 'far', d: 'M846 -20 V180 H930 V334 H852 V520 H944 V706 H864 V920' },
  { id: 'f07', layer: 'far', d: 'M-40 812 H166 V746 H342 V824 H516 V762 H694 V836 H882' },
  { id: 'f08', layer: 'far', d: 'M1014 42 H1218 V118 H1358 V260 H1468' },

  { id: 'm01', layer: 'mid', d: 'M46 186 H226 V250 H390 V188 H548', pulse: { delay: 0.2, duration: 36 } },
  { id: 'm02', layer: 'mid', d: 'M568 188 H724 V266 H910 V210 H1130 V286 H1318', pulse: { delay: 4.8, duration: 42 } },
  { id: 'm03', layer: 'mid', d: 'M146 430 H306 V350 H480 V424 H650', pulse: { delay: 9.9, duration: 38 } },
  { id: 'm04', layer: 'mid', d: 'M656 424 H820 V350 H1012 V438 H1200 V364 H1378', pulse: { delay: 15.7, duration: 44 } },
  { id: 'm05', layer: 'mid', d: 'M78 586 H240 V646 H420 V570 H632 V648 H822', pulse: { delay: 22.4, duration: 40 } },
  { id: 'm06', layer: 'mid', d: 'M836 648 H1020 V586 H1188 V664 H1390', pulse: { delay: 28.2, duration: 37 } },
  { id: 'm07', layer: 'mid', d: 'M248 78 V220 H180 V358 H258 V508 H188 V742', pulse: { delay: 34.4, duration: 43 } },
  { id: 'm08', layer: 'mid', d: 'M500 16 V160 H440 V320 H526 V492 H452 V744', pulse: { delay: 40.8, duration: 39 } },
  { id: 'm09', layer: 'mid', d: 'M736 58 V222 H672 V396 H758 V574 H690 V790', pulse: { delay: 46.7, duration: 45 } },
  { id: 'm10', layer: 'mid', d: 'M1038 18 V164 H1110 V330 H1028 V502 H1096 V792', pulse: { delay: 52.9, duration: 41 } },
  { id: 'm11', layer: 'mid', d: 'M1230 96 V246 H1320 V438 H1248 V594 H1348 V812', pulse: { delay: 58.6, duration: 46 } },
  { id: 'm12', layer: 'mid', d: 'M340 760 H538 V704 H754 V778 H936 V718 H1148', pulse: { delay: 64.8, duration: 40 } },

  { id: 'n01', layer: 'near', d: 'M116 250 H230 V306 H356', pulse: { delay: 2.7, duration: 34 } },
  { id: 'n02', layer: 'near', d: 'M406 336 H558 V286 H704', pulse: { delay: 11.8, duration: 36 } },
  { id: 'n03', layer: 'near', d: 'M812 278 H946 V326 H1088', pulse: { delay: 20.6, duration: 35 } },
  { id: 'n04', layer: 'near', d: 'M1182 444 H1294 V518 H1418', pulse: { delay: 31.5, duration: 37 } },
  { id: 'n05', layer: 'near', d: 'M210 688 H356 V620 H512', pulse: { delay: 43.1, duration: 34 } },
  { id: 'n06', layer: 'near', d: 'M626 610 H778 V674 H934', pulse: { delay: 55.2, duration: 36 } },
  { id: 'n07', layer: 'near', d: 'M994 760 H1138 V704 H1286', pulse: { delay: 66.4, duration: 35 } },
  { id: 'n08', layer: 'near', d: 'M612 102 H612 V178 H760', pulse: { delay: 72.8, duration: 38 } },
] as const;

const NODES: readonly Node[] = [
  { id: 'f01', layer: 'far', x: 168, y: 88 },
  { id: 'f02', layer: 'far', x: 526, y: 214 },
  { id: 'f03', layer: 'far', x: 1196, y: 486 },
  { id: 'f04', layer: 'far', x: 342, y: 824 },
  { id: 'm01', layer: 'mid', x: 226, y: 250 },
  { id: 'm02', layer: 'mid', x: 390, y: 188 },
  { id: 'm03', layer: 'mid', x: 724, y: 266 },
  { id: 'm04', layer: 'mid', x: 910, y: 210 },
  { id: 'm05', layer: 'mid', x: 306, y: 350 },
  { id: 'm06', layer: 'mid', x: 480, y: 424 },
  { id: 'm07', layer: 'mid', x: 820, y: 350 },
  { id: 'm08', layer: 'mid', x: 1012, y: 438 },
  { id: 'm09', layer: 'mid', x: 240, y: 646 },
  { id: 'm10', layer: 'mid', x: 632, y: 648 },
  { id: 'm11', layer: 'mid', x: 1020, y: 586 },
  { id: 'm12', layer: 'mid', x: 1188, y: 664 },
  { id: 'm13', layer: 'mid', x: 248, y: 220 },
  { id: 'm14', layer: 'mid', x: 526, y: 492 },
  { id: 'm15', layer: 'mid', x: 736, y: 222 },
  { id: 'm16', layer: 'mid', x: 1096, y: 792 },
  { id: 'n01', layer: 'near', x: 116, y: 250, hot: true },
  { id: 'n02', layer: 'near', x: 356, y: 306 },
  { id: 'n03', layer: 'near', x: 558, y: 286, hot: true },
  { id: 'n04', layer: 'near', x: 946, y: 326 },
  { id: 'n05', layer: 'near', x: 1294, y: 518, hot: true },
  { id: 'n06', layer: 'near', x: 356, y: 620 },
  { id: 'n07', layer: 'near', x: 778, y: 674, hot: true },
  { id: 'n08', layer: 'near', x: 1138, y: 704 },
] as const;

const GATES: readonly GateGlyph[] = [
  { id: 'g01', kind: 'and', x: 118, y: 118, scale: 0.78, rotate: -4 },
  { id: 'g02', kind: 'or', x: 642, y: 322, scale: 0.72, rotate: 6 },
  { id: 'g03', kind: 'not', x: 1016, y: 146, scale: 0.68, rotate: -8 },
  { id: 'g04', kind: 'and', x: 1126, y: 586, scale: 0.82, rotate: 5 },
  { id: 'g05', kind: 'or', x: 348, y: 680, scale: 0.66, rotate: -7 },
  { id: 'g06', kind: 'not', x: 772, y: 748, scale: 0.62, rotate: 9 },
] as const;

function signalStyle(trace: Trace): SignalStyle {
  return {
    '--signal-delay': `${trace.pulse?.delay ?? 0}s`,
    '--signal-duration': `${trace.pulse?.duration ?? 6}s`,
  };
}

function GateShape({ gate }: { gate: GateGlyph }): ReactElement {
  const transform = `translate(${gate.x} ${gate.y}) rotate(${gate.rotate}) scale(${gate.scale})`;

  if (gate.kind === 'and') {
    return (
      <g className="signal-field__gate" transform={transform}>
        <path d="M0 -28 H38 A28 28 0 0 1 38 28 H0 Z" />
        <line x1="-24" y1="-12" x2="0" y2="-12" />
        <line x1="-24" y1="12" x2="0" y2="12" />
        <line x1="66" y1="0" x2="88" y2="0" />
      </g>
    );
  }

  if (gate.kind === 'or') {
    return (
      <g className="signal-field__gate" transform={transform}>
        <path d="M-4 -30 C22 -24 50 -16 76 0 C50 16 22 24 -4 30 C10 12 10 -12 -4 -30 Z" />
        <line x1="-26" y1="-12" x2="4" y2="-12" />
        <line x1="-26" y1="12" x2="4" y2="12" />
        <line x1="76" y1="0" x2="100" y2="0" />
      </g>
    );
  }

  return (
    <g className="signal-field__gate" transform={transform}>
      <path d="M0 -28 L58 0 L0 28 Z" />
      <circle cx="68" cy="0" r="7" />
      <line x1="-24" y1="0" x2="0" y2="0" />
      <line x1="75" y1="0" x2="100" y2="0" />
    </g>
  );
}

export function SignalField(): ReactElement {
  return (
    <svg
      className="signal-field"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id="signal-field-grid" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M80 0 H0 V80" className="signal-field__grid-line" />
        </pattern>
        <filter id="signal-field-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect className="signal-field__grid" width="1440" height="900" fill="url(#signal-field-grid)" />

      <g className="signal-field__layer signal-field__layer--far">
        {TRACES.filter(trace => trace.layer === 'far').map(trace => (
          <path key={trace.id} className="signal-field__trace" d={trace.d} />
        ))}
      </g>

      <g className="signal-field__glyphs">
        {GATES.map(gate => (
          <GateShape key={gate.id} gate={gate} />
        ))}
      </g>

      <g className="signal-field__layer signal-field__layer--mid">
        {TRACES.filter(trace => trace.layer === 'mid').map(trace => (
          <g key={trace.id}>
            <path className="signal-field__trace" d={trace.d} />
            {trace.pulse ? (
              <>
                <path className="signal-field__trace-glow" d={trace.d} pathLength={100} style={signalStyle(trace)} />
                <path className="signal-field__pulse" d={trace.d} pathLength={100} style={signalStyle(trace)} />
              </>
            ) : null}
          </g>
        ))}
      </g>

      <g className="signal-field__layer signal-field__layer--near">
        {TRACES.filter(trace => trace.layer === 'near').map(trace => (
          <g key={trace.id}>
            <path className="signal-field__trace" d={trace.d} />
            {trace.pulse ? (
              <>
                <path className="signal-field__trace-glow" d={trace.d} pathLength={100} style={signalStyle(trace)} />
                <path className="signal-field__pulse signal-field__pulse--near" d={trace.d} pathLength={100} style={signalStyle(trace)} />
              </>
            ) : null}
          </g>
        ))}
      </g>

      <g className="signal-field__nodes">
        {NODES.map(node => (
          <circle
            key={node.id}
            className={`signal-field__node signal-field__node--${node.layer}${node.hot ? ' signal-field__node--hot' : ''}`}
            cx={node.x}
            cy={node.y}
            r={node.layer === 'near' ? 4.8 : node.layer === 'mid' ? 3.8 : 2.6}
          />
        ))}
      </g>
    </svg>
  );
}
