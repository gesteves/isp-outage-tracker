import { fireEvent, render, screen } from '@testing-library/react'
import Toggle from '@/components/Toggle'

describe('Toggle', () => {
  it('is an accessible switch reflecting its state', () => {
    const { rerender } = render(<Toggle label="Keep screen on" checked={false} onChange={() => {}} />)
    const toggle = screen.getByRole('switch', { name: 'Keep screen on' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    rerender(<Toggle label="Keep screen on" checked onChange={() => {}} />)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onChange with the opposite state', () => {
    const onChange = jest.fn()
    render(<Toggle label="Keep screen on" checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('shows a description when given', () => {
    render(<Toggle label="Keep screen on" checked onChange={() => {}} description="Tap to retry." />)
    expect(screen.getByText('Tap to retry.')).toBeInTheDocument()
  })
})
