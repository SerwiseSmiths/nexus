import { ComplaintStage } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { WalletService } from '@/services/wallet.service';

export class HomeService {
  static async getProviderHomeStats(userId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [wallet, todayLedger, taskCount] = await Promise.all([
      WalletService.getWallet(userId),
      prisma.walletLedger.aggregate({
        where: {
          userId,
          isDeleted: false,
          type:      'CREDIT',
          createdAt: { gte: startOfToday },
        },
        _sum: { amount: true },
      }),
      prisma.complaint.count({
        where: {
          providerId: userId,
          isDeleted:  false,
          stage:      { notIn: [ComplaintStage.COMPLETED, ComplaintStage.REJECTED] },
        },
      }),
    ]);

    return {
      totalEarnings: wallet.balance,
      todayEarnings: todayLedger._sum.amount ?? 0,
      taskCount,
    };
  }
}
