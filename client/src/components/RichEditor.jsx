import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Simple contentEditable editor. Saves HTML to item.data.body (the server sanitizes it).
export default function RichEditor({ item, onSaved, onError }) {
  const ref = useRef(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = item.data?.body || '';
    setDirty(false);
  }, [item._id]);

  const cmd = (name, value = null) => {
    ref.current.focus();
    document.execCommand(name, false, value);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateItem(item._id, { data: { ...item.data, body: ref.current.innerHTML } });
      setDirty(false);
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card editor-card">
      <div className="toolbar">
        <button type="button" className="btn small" onClick={() => cmd('bold')}><b>B</b></button>
        <button type="button" className="btn small" onClick={() => cmd('italic')}><i>I</i></button>
        <button type="button" className="btn small" onClick={() => cmd('underline')}><u>U</u></button>
        <button type="button" className="btn small" onClick={() => cmd('formatBlock', 'H2')}>H2</button>
        <button type="button" className="btn small" onClick={() => cmd('insertUnorderedList')}>• List</button>
        <button type="button" className="btn small" onClick={() => cmd('insertOrderedList')}>1. List</button>
        <button type="button" className="btn small" onClick={() => {
          const url = window.prompt('Link address (https://...)');
          if (url && /^https?:\/\//.test(url)) cmd('createLink', url);
        }}>Link</button>
        <span className="grow" />
        <button type="button" className="btn primary small" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      <div
        ref={ref}
        className="doc-body"
        contentEditable
        suppressContentEditableWarning
        onInput={() => setDirty(true)}
      />
    </div>
  );
}
