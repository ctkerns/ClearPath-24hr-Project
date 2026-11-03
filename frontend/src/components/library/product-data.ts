import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

// Products (PRD F8, US-66): the financial products this workspace markets. Managers keep the list in the
// Library's Products tab. Rules, disclosures, building blocks, the rate sheet, routing rules and materials
// refer to a product by its ID, so adding one (for example auto loans) needs no code change.
// The list is never hard-coded in the frontend: every picker, filter and label reads it from here.
//
// API (to build: see docs/products-api.md):
//   GET   /api/library/products        every product, active and inactive, with what uses it
//   POST  /api/library/products        { name, description } → the new product; the server makes the ID
//   PATCH /api/library/products/<id>   { name?, description?, active? } → the saved product

/** A product's ID, for example "personal_loan". Stable: a rename keeps it, so nothing that refers to it changes. */
export type ProductId = string

export type Product = {
  id: ProductId
  name: string
  /** What the product is, in one or two sentences, for the people who choose it on the submit form. */
  description: string
  /** An inactive product cannot be chosen for new materials, rules or routing; existing records keep it (F8). */
  active: boolean
  createdAt: string
  createdBy: string
  /** How many records refer to the product now, from the server. Rate sheet rows are in the current sheet. */
  usage: ProductUsage
}

export type ProductUsage = {
  materials: number
  /** Materials that are Submitted or In review now. A deactivation does not stop their review. */
  materialsInReview: number
  rules: number
  disclosures: number
  blocks: number
  rateSheetRows: number
  routingRules: number
}

export const productsQueryKey = ['products'] as const

export function useProducts() {
  return useQuery({
    queryKey: productsQueryKey,
    queryFn: () => api<Product[]>('GET', '/library/products'),
    // The list changes rarely, and every page shows product names, so it stays cached.
    staleTime: 5 * 60_000,
  })
}

/**
 * The name of a product by its ID. While the list loads, or for an ID that is not in it, it shows the ID
 * with spaces ("auto_loan" becomes "auto loan"), so a label is never blank.
 */
export function useProductName() {
  const products = useProducts().data
  return (id: ProductId) => products?.find((p) => p.id === id)?.name ?? id.replaceAll('_', ' ')
}

/**
 * The products a picker offers: the active ones, plus any inactive product the record has now, so an edit
 * never drops it without the person seeing it. Sorted by name.
 */
export function pickableProducts(products: Product[], current: readonly ProductId[] = []) {
  return products.filter((p) => p.active || current.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name))
}

/** Every product, active first, then by name. For filters, which must find old records too. */
export function filterableProducts(products: Product[]) {
  return [...products].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
}

export type ProductInput = Pick<Product, 'name' | 'description'>

/** True when another product already has this name (names are compared without case). */
export const productNameTaken = (products: Product[], name: string, except?: ProductId) =>
  products.some((p) => p.id !== except && p.name.trim().toLowerCase() === name.trim().toLowerCase())

/**
 * Managers and Admins only (R3); the server checks. Each call resolves with the saved product, or rejects
 * with an ApiError, so the dialog can show what went wrong. A change reloads every list that shows product names.
 */
export function useProductUpdate() {
  const queryClient = useQueryClient()
  const after = async (p: Product) => {
    await queryClient.invalidateQueries({ queryKey: productsQueryKey })
    return p
  }
  return {
    create: (input: ProductInput) => api<Product>('POST', '/library/products', input).then(after),
    edit: (id: ProductId, input: ProductInput) => api<Product>('PATCH', `/library/products/${encodeURIComponent(id)}`, input).then(after),
    setActive: (id: ProductId, active: boolean) => api<Product>('PATCH', `/library/products/${encodeURIComponent(id)}`, { active }).then(after),
  }
}
