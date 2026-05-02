export interface ProductListQuery {
  page: number;
  limit: number;
  search?: string | undefined;
  lowStock?: boolean | undefined;
}

export interface ProductIdParams {
  id: string;
}

export interface CreateProductInput {
  name: string;
  sku?: string | undefined;
  barcode?: string | undefined;
  unit: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice?: number | undefined;
  gstRate: number;
  hsnCode?: string | undefined;
  currentStock: number;
  reorderLevel?: number | undefined;
  supplierId?: string | undefined;
  verticalData?: Record<string, unknown> | undefined;
}

export type UpdateProductInput = {
  [Key in keyof CreateProductInput]?: CreateProductInput[Key] | undefined;
};

export interface AddBatchInput {
  batchNumber: string;
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
