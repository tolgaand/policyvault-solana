import { AnchorProvider, BN, Program } from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

// Vite can import JSON as an object
import idlJson from './idl/policyvault.json'

type IdlJsonWithAddress = { address: string }

export const IDL = idlJson as unknown as Idl

export function programId(): PublicKey {
  // Anchor IDL v0.1.0 includes `address`
  const { address } = idlJson as unknown as IdlJsonWithAddress
  return new PublicKey(address)
}

export function getProgram(provider: AnchorProvider): Program {
  // Anchor 0.32 expects (idl, provider) and uses idl.address internally.
  return new Program(IDL, provider)
}

export function bn(n: number | string | bigint): BN {
  return new BN(n.toString())
}

export const SEEDS = {
  vault: 'vault',
  policy: 'policy',
} as const

export async function deriveVaultPda(owner: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync([
    Buffer.from(SEEDS.vault),
    owner.toBuffer(),
  ], programId())
}

export async function derivePolicyPda(vault: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync([
    Buffer.from(SEEDS.policy),
    vault.toBuffer(),
  ], programId())
}
