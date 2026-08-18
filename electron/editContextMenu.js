function createEditContextMenuTemplate({
  editFlags = {},
  inputFieldType = 'none',
  isEditable = false,
  selectionText = ''
} = {}) {
  const hasSelection = selectionText.length > 0;
  const selectionIsSensitive = inputFieldType === 'password';
  const items = [];

  if (isEditable) {
    items.push(
      { role: 'undo', enabled: Boolean(editFlags.canUndo) },
      { role: 'redo', enabled: Boolean(editFlags.canRedo) },
      { type: 'separator' },
      {
        role: 'cut',
        enabled: !selectionIsSensitive && hasSelection && Boolean(editFlags.canCut)
      },
      {
        role: 'copy',
        enabled: !selectionIsSensitive && hasSelection && Boolean(editFlags.canCopy)
      },
      { role: 'paste', enabled: Boolean(editFlags.canPaste) },
      { type: 'separator' },
      { role: 'selectAll', enabled: Boolean(editFlags.canSelectAll) }
    );
    return items;
  }

  if (!hasSelection) return [];
  return [
    { role: 'copy', enabled: Boolean(editFlags.canCopy) },
    { type: 'separator' },
    { role: 'selectAll', enabled: Boolean(editFlags.canSelectAll) }
  ];
}

module.exports = { createEditContextMenuTemplate };
