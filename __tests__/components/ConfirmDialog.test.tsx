import { fireEvent, render, screen } from '@testing-library/react'
import ConfirmDialog from '@/components/ConfirmDialog'

function renderDialog(open: boolean, handlers = { onConfirm: jest.fn(), onCancel: jest.fn() }) {
  const utils = render(
    <ConfirmDialog open={open} title="Clear All Logs?" confirmLabel="Clear All" {...handlers}>
      This cannot be undone.
    </ConfirmDialog>,
  )
  return { ...utils, ...handlers }
}

describe('ConfirmDialog', () => {
  it('opens as a modal when open, and closes when not', () => {
    const { rerender, onConfirm, onCancel } = renderDialog(true)
    const dialog = screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(dialog).toHaveAccessibleName('Clear All Logs?')

    rerender(
      <ConfirmDialog open={false} title="Clear All Logs?" confirmLabel="Clear All" onConfirm={onConfirm} onCancel={onCancel}>
        This cannot be undone.
      </ConfirmDialog>,
    )
    expect(dialog.open).toBe(false)
  })

  it('confirms and cancels', () => {
    const { onConfirm, onCancel } = renderDialog(true)
    fireEvent.click(screen.getByText('Clear All'))
    expect(onConfirm).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('cancels on Esc, leaving closing to the parent', () => {
    const { onCancel } = renderDialog(true)
    const dialog = screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement
    const event = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(event)
    expect(onCancel).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('cancels on a backdrop click, but not on clicks inside', () => {
    const { onCancel } = renderDialog(true)
    fireEvent.click(screen.getByText('This cannot be undone.'))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('dialog', { hidden: true }))
    expect(onCancel).toHaveBeenCalled()
  })
})
