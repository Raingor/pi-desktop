// ModelSelector — dropdown to switch model mid-session

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface ModelSelectorProps {
  models: ModelOption[];
  currentModel: { provider: string; modelId: string } | null;
  onChange: (provider: string, modelId: string) => void;
}

export function ModelSelector({ models, currentModel, onChange }: ModelSelectorProps) {
  const currentLabel = currentModel
    ? models.find(
        (m) => m.id === currentModel.modelId && m.provider === currentModel.provider
      )?.name || currentModel.modelId
    : 'Select model';

  return (
    <select
      value={currentModel ? `${currentModel.provider}/${currentModel.modelId}` : ''}
      onChange={(e) => {
        const [provider, modelId] = e.target.value.split('/');
        onChange(provider, modelId);
      }}
      className="rounded px-2 py-1 text-xs"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
        cursor: 'pointer',
      }}
    >
      {models.length === 0 && <option value="">{currentLabel}</option>}
      {models.map((m) => (
        <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
          {m.name || m.id}
        </option>
      ))}
    </select>
  );
}
