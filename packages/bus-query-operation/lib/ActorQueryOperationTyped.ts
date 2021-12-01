import { KeysInitSparql, KeysQueryOperation } from '@comunica/context-entries';
import type { ActionContext, IActorArgs, IActorTest } from '@comunica/core';
import type { IQueryableResult, IQueryableResultStream, IPhysicalQueryPlanLogger } from '@comunica/types';
import type { Algebra } from 'sparqlalgebrajs';
import type { IActionQueryOperation } from './ActorQueryOperation';
import { ActorQueryOperation } from './ActorQueryOperation';

/**
 * A base implementation for query operation actors for a specific operation type.
 */
export abstract class ActorQueryOperationTyped<O extends Algebra.Operation> extends ActorQueryOperation {
  public readonly operationName: string;

  protected constructor(args: IActorArgs<IActionQueryOperation, IActorTest, IQueryableResult>,
    operationName: string) {
    super(<any> { ...args, operationName });
    if (!this.operationName) {
      throw new Error('A valid "operationName" argument must be provided.');
    }
  }

  public async test(action: IActionQueryOperation): Promise<IActorTest> {
    if (!action.operation) {
      throw new Error('Missing field \'operation\' in a query operation action.');
    }
    if (action.operation.type !== this.operationName) {
      throw new Error(`Actor ${this.name} only supports ${this.operationName} operations, but got ${
        action.operation.type}`);
    }
    const operation: O = <O> action.operation;
    return this.testOperation(operation, action.context);
  }

  public async run(action: IActionQueryOperation): Promise<IQueryableResult> {
    // Log to physical plan
    if (action.context && action.context.has(KeysInitSparql.physicalQueryPlanLogger)) {
      const physicalQueryPlanLogger: IPhysicalQueryPlanLogger = action.context
        .get(KeysInitSparql.physicalQueryPlanLogger);
      physicalQueryPlanLogger.logOperation(
        action.operation.type,
        undefined,
        action.operation,
        action.context.get(KeysInitSparql.physicalQueryPlanNode),
        this.name,
        {},
      );
      action.context = action.context.set(KeysInitSparql.physicalQueryPlanNode, action.operation);
    }

    const operation: O = <O> action.operation;
    const subContext = action.context && action.context.set(KeysQueryOperation.operation, operation);
    const output: IQueryableResult = await this.runOperation(operation, subContext);
    if ((<IQueryableResultStream> output).metadata) {
      (<IQueryableResultStream> output).metadata =
        ActorQueryOperation.cachifyMetadata((<IQueryableResultStream> output).metadata);
    }
    return output;
  }

  protected abstract testOperation(operation: O, context: ActionContext | undefined): Promise<IActorTest>;

  protected abstract runOperation(operation: O, context: ActionContext | undefined):
  Promise<IQueryableResult>;
}
