import { fireEvent, render, screen } from '@testing-library/react'
import ExportMenu, { ExportOption } from '@/components/ExportMenu'

function setup(disabled = false) {
  const options: ExportOption[] = [
    { id: 'csv', label: 'CSV', description: 'For spreadsheets', onSelect: jest.fn() },
    { id: 'md', label: 'Markdown', description: 'For chats', onSelect: jest.fn() },
  ]
  render(
    <>
      <ExportMenu options={options} disabled={disabled} />
      <button type="button">Elsewhere</button>
    </>,
  )
  return { options, trigger: screen.getByRole('button', { name: 'Export' }) }
}

const items = () => screen.getAllByRole('menuitem')

describe('ExportMenu', () => {
  it('is closed until opened', () => {
    const { trigger } = setup()
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens on click with the first format focused', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('menu').id)
    expect(items().map(item => item.textContent)).toEqual(['CSVFor spreadsheets', 'MarkdownFor chats'])
    expect(items()[0]).toHaveFocus()
  })

  it('runs the chosen format and closes', () => {
    const { options, trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /Markdown/ }))
    expect(options[1].onSelect).toHaveBeenCalledTimes(1)
    expect(options[0].onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('moves between formats with the arrow, Home and End keys', () => {
    const { trigger } = setup()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(items()[0]).toHaveFocus()
    fireEvent.keyDown(items()[0], { key: 'ArrowDown' })
    expect(items()[1]).toHaveFocus()
    fireEvent.keyDown(items()[1], { key: 'ArrowDown' })
    expect(items()[0]).toHaveFocus()
    fireEvent.keyDown(items()[0], { key: 'ArrowUp' })
    expect(items()[1]).toHaveFocus()
    fireEvent.keyDown(items()[1], { key: 'Home' })
    expect(items()[0]).toHaveFocus()
    fireEvent.keyDown(items()[0], { key: 'End' })
    expect(items()[1]).toHaveFocus()
  })

  it('opens on the last format with ArrowUp', () => {
    const { trigger } = setup()
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(items()[1]).toHaveFocus()
  })

  it('opens from the keyboard with Enter', () => {
    const { trigger } = setup()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the button', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(items()[0], { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on Tab', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(items()[0], { key: 'Tab' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on a click outside, and on a second click of the button', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.pointerDown(items()[0])
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes when it becomes disabled', () => {
    const options: ExportOption[] = [{ id: 'csv', label: 'CSV', description: '', onSelect: jest.fn() }]
    const { rerender } = render(<ExportMenu options={options} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    rerender(<ExportMenu options={options} disabled />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    rerender(<ExportMenu options={options} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it("doesn't open while disabled", () => {
    const { trigger } = setup(true)
    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
