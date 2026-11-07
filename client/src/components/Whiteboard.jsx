import { useRef, useState } from 'react';
import { api } from '../api.js';

// Freehand whiteboard. Strokes are arrays of points stored in item.data.strokes.
const COLORS = ['#1f2330', '#7b68ee', '#dc2626', '#16a34a', '#d97706'];

export default function Whiteboard({ item, onSaved, onError }) {
  const [strokes, setStrokes] = useState(item.data?.strokes || []);
  const [color, setColor] = useState(COLORS[0]);
  const drawing = useRef(null);
  const svgRef = useRef(null);

  const point = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    return [Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top)];
  };

  const onDown = (e) => {
    drawing.current = { color, points: [point(e)] };
    svgRef.current.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    if (!drawing.current) return;
    drawing.current.points.push(point(e));
    const live = { ...drawing.current };
    setStrokes((s) => [...s.filter((x) => !x.temp), { ...live, temp: true }]);
  };

  const onUp = async () => {
    if (!drawing.current) return;
    const finished = { color: drawing.current.color, points: drawing.current.points };
    drawing.current = null;
    const next = [...strokes.filter((s) => !s.temp), finished];
    setStrokes(next);
    try {
      await api.updateItem(item._id, { data: { ...item.data, strokes: next } });
      onSaved();
    } catch (err) {
      onError(err.message);
    }
  };

  const clearAll = async () => {
    setStrokes([]);
    try {
      await api.updateItem(item._id, { data: { ...item.data, strokes: [] } });
      onSaved();
    } catch (err) {
      onError(err.message);
    }
  };

  const toPath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');

  return (
    <div className="card">
      <div className="toolbar">
        {COLORS.map((c) => (
          <button key={c} type="button" className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />
        ))}
        <span className="grow" />
        <button type="button" className="btn small" onClick={clearAll}>Clear board</button>
      </div>
      <svg
        ref={svgRef}
        className="board"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        {strokes.map((s, i) => (
          <path key={i} d={toPath(s.points)} stroke={s.color} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </div>
  );
}
