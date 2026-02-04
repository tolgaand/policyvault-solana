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
  audit: 'audit',
  recipient: 'recipient',
} as const

function u64LeBytes(n: BN | bigint | number): Buffer {
  const v = typeof n === 'bigint' ? n : BigInt(n.toString())
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(v)
  return b
}

export async function deriveVaultPda(owner: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.vault), owner.toBuffer()], programId())
}

export async function derivePolicyPda(vault: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.policy), vault.toBuffer()], programId())
}

export async function deriveAuditEventPda(policy: PublicKey, sequence: BN | bigint | number): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.audit), policy.toBuffer(), u64LeBytes(sequence)],
    programId(),
  )
}

export async function deriveRecipientSpendPda(policy: PublicKey, recipient: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.recipient), policy.toBuffer(), recipient.toBuffer()],
    programId(),
  )
}
