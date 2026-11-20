import { fireEvent, render, screen } from '@testing-library/react'
import NoteDialog from '@/components/NoteDialog'
import { MAX_NOTE_LENGTH } from '@/lib/annotations'

const NOON = new Date(2026, 10, 20, 12, 0, 30).getTime()

function setup(onSave = jest.fn(() => true)) {
  const onCancel = jest.fn()
  render(<NoteDialog title="Add Note" initialTime={NOON} onSave={onSave} onCancel={onCancel} />)
  return { onSave, onCancel }
}

describe('NoteDialog', () => {
  it('opens with the given time, to the minute', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Add Note' })).toHaveAttribute('open')
    expect(screen.getByLabelText('When')).toHaveValue('2026-11-20T12:00')
    expect(screen.getByLabelText('Note')).toHaveAttribute('maxlength', String(MAX_NOTE_LENGTH))
  })

  it('saves the date, time and text entered', () => {
    const { onSave } = setup()
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-11-18T09:30' } })
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'New modem' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Note' }))
    expect(onSave).toHaveBeenCalledWith({ time: new Date(2026, 10, 18, 9, 30).getTime(), text: 'New modem' })
  })

  it('saves with Cmd/Ctrl+Enter', () => {
    const { onSave } = setup()
    const text = screen.getByLabelText('Note')
    fireEvent.change(text, { target: { value: 'New modem' } })
    fireEvent.keyDown(text, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.keyDown(text, { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('needs some text and a time', () => {
    const { onSave } = setup()
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Note' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write something to note.')

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'New modem' } })
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Note' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a date and time.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('stays open if the note could not be saved', () => {
    setup(jest.fn(() => false))
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'New modem' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Note' }))
    expect(screen.getByRole('alert')).toHaveTextContent('couldn’t be saved')
  })

  it('cancels', () => {
    const { onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
