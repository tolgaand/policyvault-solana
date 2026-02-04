import '@solana/wallet-adapter-react-ui/styles.css'
import './wallet-ui.css'

import DemoApp from './DemoApp'
import { Providers } from './Providers'

export default function DemoRoot() {
  return (
    <Providers>
      <DemoApp />
    </Providers>
  )
}
