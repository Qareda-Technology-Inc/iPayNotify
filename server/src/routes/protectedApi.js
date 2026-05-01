import express from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { attachOrganization } from '../middleware/attachOrganization.js';
import { routersApi } from './routers.js';
import { packagesRouter } from './packages.js';
import { pppoeRouter } from './pppoe.js';
import { hotspotRouter } from './hotspot.js';
import { usersRouter } from './users.js';
import { remoteAccessRouter } from './remoteAccess.js';
import { messageTemplatesRouter } from './messageTemplates.js';
import { messageBroadcastsRouter } from './messageBroadcasts.js';
import { jobsRouter } from './jobs.js';
import { dashboardRouter } from './dashboard.js';
import { organizationRouter } from './organization.js';
import { ticketSalesRouter } from './ticketSales.js';

const router = express.Router();

router.use(requireAuth);
router.use(attachOrganization);
router.use('/organization', organizationRouter);
router.use('/dashboard', dashboardRouter);
router.use('/routers', routersApi);
router.use('/packages', packagesRouter);
router.use('/users', usersRouter);
router.use('/remote-access', remoteAccessRouter);
router.use('/message-templates', messageTemplatesRouter);
router.use('/message-broadcasts', messageBroadcastsRouter);
router.use('/pppoe', pppoeRouter);
router.use('/hotspot', hotspotRouter);
router.use('/jobs', jobsRouter);
router.use('/ticket-sales', ticketSalesRouter);

export const protectedApiRouter = router;
