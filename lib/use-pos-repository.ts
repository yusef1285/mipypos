import { useMemo } from 'react';
import { useApp } from '@/lib/app-context';
import * as Database from '@/lib/database';
import { requestHostOperation } from '@/lib/network/client';
import { redactCosts } from '@/lib/finance-privacy';
import { operationPermissions } from '@/lib/network/operations';
import { canAccess } from '@/lib/permissions';
import { mutationOperations } from '@/lib/network/operations';
import type { PosOperation, PosArgs, PosResult } from '@/lib/network/operations';

type Repository = { [K in PosOperation]: (...args: PosArgs<K>) => Promise<PosResult<K>> };

export function usePosRepository(): Repository {
  const { networkConfig, user } = useApp();
  return useMemo(() => {
    const bind =
      <K extends PosOperation>(
        operation: K,
        handler: (...args: PosArgs<K>) => Promise<PosResult<K>>,
      ): ((...args: PosArgs<K>) => Promise<PosResult<K>>) =>
      (...args: PosArgs<K>): Promise<PosResult<K>> => {
        const auditReads = [
          'listProducts',
          'listAreas',
          'listAreaStock',
          'listMovements',
          'getCashClosurePreview',
          'listCashClosures',
          'getDailyReport',
          'getHomeSummary',
          'getExportRows',
          'getSale',
          'getDemoUsage',
          'getAuditSnapshot',
        ];
        const module =
          operation === 'getExportRows' && args[0] === 'inventory'
            ? 'products'
            : operationPermissions[operation];
        if (
          !canAccess(user?.role, module) &&
          !(user?.role === 'auditor' && auditReads.includes(operation))
        )
          return Promise.reject(new Error('Tu usuario no tiene permiso para esta operación.'));
        if (
          user?.role === 'auditor' &&
          (mutationOperations.has(operation) || operation === 'registerCashWithdrawal')
        )
          return Promise.reject(new Error('El auditor solo puede consultar.'));
        if (networkConfig.mode === 'client') {
          if (!networkConfig.hostUrl)
            return Promise.reject(new Error('Escanea el QR del administrador.'));
          return requestHostOperation(
            networkConfig.hostUrl,
            operation,
            args,
            user?.username ?? '',
            networkConfig.clientId,
          );
        }
        return handler(...args).then((result) =>
          user?.role === 'admin' || result == null ? result : redactCosts(result),
        );
      };
    return {
      getInvestmentData: bind('getInvestmentData', () =>
        Database.getInvestmentData(user?.username ?? ''),
      ),
      setProductCost: bind('setProductCost', (input, _username, command) =>
        Database.setProductCost(input, user?.username ?? '', command),
      ),
      receiveCostedStock: bind('receiveCostedStock', (input, _username, command) =>
        Database.receiveCostedStock(input, user?.username ?? '', command),
      ),
      getFinanceReport: bind('getFinanceReport', (filter) =>
        Database.getFinanceReport(filter, user?.username ?? ''),
      ),
      getConsumptionData: bind('getConsumptionData', () =>
        Database.getConsumptionData(user?.username ?? ''),
      ),
      registerConsumption: bind('registerConsumption', (input, _username, command) =>
        Database.registerConsumption(input, user?.username ?? '', command),
      ),
      cancelConsumption: bind('cancelConsumption', (input, _username, command) =>
        Database.cancelConsumption(input, user?.username ?? '', command),
      ),
      registerSaleAdjustment: bind('registerSaleAdjustment', (input, _username, command) =>
        Database.registerSaleAdjustment(input, user?.username ?? '', command),
      ),
      setConsumptionPermission: bind(
        'setConsumptionPermission',
        (id, allowed, _username, command) =>
          Database.setConsumptionPermission(id, allowed, user?.username ?? '', command),
      ),
      getAuditSnapshot: bind('getAuditSnapshot', Database.getAuditSnapshot),
      getDemoUsage: bind('getDemoUsage', Database.getDemoUsage),
      listProducts: bind('listProducts', Database.listProducts),
      listAreas: bind('listAreas', Database.listAreas),
      listAreaStock: bind('listAreaStock', Database.listAreaStock),
      saveProduct: bind('saveProduct', Database.saveProduct),
      deleteProduct: bind('deleteProduct', Database.deleteProduct),
      importProducts: bind('importProducts', Database.importProducts),
      registerMovement: bind('registerMovement', Database.registerMovement),
      addArea: bind('addArea', Database.addArea),
      listMovements: bind('listMovements', Database.listMovements),
      listUsers: bind('listUsers', Database.listUsers),
      saveUser: bind('saveUser', Database.saveUser),
      deleteUser: bind('deleteUser', Database.deleteUser),
      getCashClosurePreview: bind('getCashClosurePreview', Database.getCashClosurePreview),
      openCashSession: bind('openCashSession', Database.openCashSession),
      closeCashSession: bind('closeCashSession', Database.closeCashSession),
      registerCashWithdrawal: bind('registerCashWithdrawal', Database.registerCashWithdrawal),
      authorizeCashDifference: bind('authorizeCashDifference', Database.authorizeCashDifference),
      listCashClosures: bind('listCashClosures', Database.listCashClosures),
      getDailyReport: bind('getDailyReport', Database.getDailyReport),
      getHomeSummary: bind('getHomeSummary', Database.getHomeSummary),
      getExportRows: bind('getExportRows', Database.getExportRows),
      getSale: bind('getSale', Database.getSale),
      findTransferTransaction: bind('findTransferTransaction', Database.findTransferTransaction),
    } satisfies Repository;
  }, [networkConfig, user?.username, user?.role]);
}
