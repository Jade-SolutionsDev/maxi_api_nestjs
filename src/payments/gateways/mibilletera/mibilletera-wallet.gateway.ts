import { Injectable } from '@nestjs/common';
import { MibilleteraGateway } from './mibilletera.gateway';

/**
 * Mi Billetera paid from the app's balance instead of a crypto deposit. Same
 * merchant account, same credentials, same webhook — only the `method` on the
 * charge differs, which is the whole reason this is a subclass and not another
 * integration.
 *
 * Its charges are stored with this code, but Mi Billetera posts every callback
 * to the ONE notification URL registered for the account (the `mibilletera`
 * route). PaymentsService resolves the charge by reference for exactly that
 * reason — see the lookup in handleWebhook.
 */
@Injectable()
export class MibilleteraWalletGateway extends MibilleteraGateway {
  readonly code = 'mibilletera-wallet';
  protected readonly method = 'WALLET' as const;
}
