const { createEditContextMenuTemplate } = require('../../../electron/editContextMenu');

describe('desktop edit context menu', () => {
  it('offers enabled editing actions for editable controls', () => {
    expect(createEditContextMenuTemplate({
      isEditable: true,
      selectionText: 'selected',
      editFlags: {
        canUndo: true,
        canRedo: false,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canSelectAll: true
      }
    })).toEqual([
      { role: 'undo', enabled: true },
      { role: 'redo', enabled: false },
      { type: 'separator' },
      { role: 'cut', enabled: true },
      { role: 'copy', enabled: true },
      { role: 'paste', enabled: true },
      { type: 'separator' },
      { role: 'selectAll', enabled: true }
    ]);
  });

  it('offers copy for selected read-only text and nothing without a selection', () => {
    expect(createEditContextMenuTemplate({
      selectionText: 'selected',
      editFlags: { canCopy: true, canSelectAll: true }
    })).toEqual([
      { role: 'copy', enabled: true },
      { type: 'separator' },
      { role: 'selectAll', enabled: true }
    ]);
    expect(createEditContextMenuTemplate()).toEqual([]);
  });

  it('does not expose password selections to cut or copy actions', () => {
    const menu = createEditContextMenuTemplate({
      inputFieldType: 'password',
      isEditable: true,
      selectionText: 'secret',
      editFlags: {
        canCut: true,
        canCopy: true,
        canPaste: true,
        canSelectAll: true
      }
    });
    expect(menu.find(item => item.role === 'cut').enabled).toBe(false);
    expect(menu.find(item => item.role === 'copy').enabled).toBe(false);
    expect(menu.find(item => item.role === 'paste').enabled).toBe(true);
  });
});
