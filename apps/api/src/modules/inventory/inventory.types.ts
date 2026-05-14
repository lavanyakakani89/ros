export interface ProductListQuery {
  page: number;
  limit: number;
  search?: string | undefined;
  lowStock?: boolean | undefined;
}

export interface ProductLookupQuery {
  code: string;
}

export interface ProductIdParams {
  id: string;
}

export interface CreateProductInput {
  name: string;
  sku?: string | undefined;
  barcode?: string | undefined;
  description?: string | undefined;
  partGroup?: string | undefined;
  legacySubCategoryId?: string | undefined;
  categoryId?: string | undefined;
  unit: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice?: number | undefined;
  wholesalePrice?: number | undefined;
  defaultDiscountPercent?: number | undefined;
  gstRate: number;
  cessRate: number;
  hsnCode?: string | undefined;
  currentStock: number;
  reorderLevel?: number | undefined;
  purchaseUnit?: string | undefined;
  salesUnit?: string | undefined;
  alternateUnit?: string | undefined;
  conversionValue?: number | undefined;
  godown?: string | undefined;
  rack?: string | undefined;
  defaultSaleQty?: number | undefined;
  supplierId?: string | undefined;
  verticalData?: Record<string, unknown> | undefined;
}

export type UpdateProductInput = {
  [Key in keyof CreateProductInput]?: CreateProductInput[Key] | undefined;
};

export interface AddBatchInput {
  batchNumber: string;
  mfgDate?: Date | undefined;
  expiryDate: Date;
  quantity: number;
  purchasePrice: number;
}

export interface StockAdjustmentInput {
  productId: string;
  quantityChange: number;
  reason: string;
  notes?: string | undefined;
}

export interface StockMovementQuery {
  page: number;
  limit: number;
  from?: Date | undefined;
  to?: Date | undefined;
  type?: "adjustment" | "sale" | "purchase" | "return" | undefined;
}

export interface StockMovementRecord {
  date: Date;
  type: "adjustment" | "sale" | "purchase" | "return";
  qty: number;
  reference: string;
  notes: string;
  runningBalance: number;
}
