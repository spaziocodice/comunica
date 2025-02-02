import { ActorAbstractPath } from '@comunica/actor-abstract-path';
import { BindingsFactory } from '@comunica/bindings-factory';
import type { IActorQueryOperationTypedMediatedArgs } from '@comunica/bus-query-operation';
import { ActorQueryOperation } from '@comunica/bus-query-operation';
import { MetadataValidationState } from '@comunica/metadata';
import type { Bindings, IQueryOperationResult, IActionContext, BindingsStream } from '@comunica/types';
import {
  SingletonIterator, UnionIterator,
} from 'asynciterator';
import { Algebra } from 'sparqlalgebrajs';

const BF = new BindingsFactory();

/**
 * A comunica Path ZeroOrOne Query Operation Actor.
 */
export class ActorQueryOperationPathZeroOrOne extends ActorAbstractPath {
  public constructor(args: IActorQueryOperationTypedMediatedArgs) {
    super(args, Algebra.types.ZERO_OR_ONE_PATH);
  }

  public async runOperation(
    operation: Algebra.Path,
    context: IActionContext,
  ): Promise<IQueryOperationResult> {
    const predicate = <Algebra.ZeroOrOnePath> operation.predicate;

    const extra: Bindings[] = [];

    // Both subject and object non-variables
    if (operation.subject.termType !== 'Variable' &&
      operation.object.termType !== 'Variable' &&
      operation.subject.equals(operation.object)) {
      return {
        type: 'bindings',
        bindingsStream: new SingletonIterator(BF.bindings()),
        metadata: () => Promise.resolve({
          state: new MetadataValidationState(),
          cardinality: { type: 'exact', value: 1 },
          canContainUndefs: false,
          variables: [],
        }),
      };
    }

    // Check if we require a distinct path operation
    const distinct = await this.isPathArbitraryLengthDistinct(context, operation);
    if (distinct.operation) {
      return distinct.operation;
    }
    context = distinct.context;

    // Create an operator that resolve to the "One" part
    const bindingsOne = ActorQueryOperation.getSafeBindings(await this.mediatorQueryOperation.mediate({
      context,
      operation: ActorAbstractPath.FACTORY
        .createPath(operation.subject, predicate.path, operation.object, operation.graph),
    }));

    // Determine the bindings stream based on the variable-ness of subject and object
    let bindingsStream: BindingsStream;
    if (operation.subject.termType === 'Variable' && operation.object.termType === 'Variable') {
      // Both subject and object are variables
      // To determine the "Zero" part, we
      // query ?s ?p ?o. FILTER ?s = ?0, to get all possible namedNodes in de the db
      const varP = this.generateVariable(operation);
      const bindingsZero = ActorQueryOperation.getSafeBindings(
        await this.mediatorQueryOperation.mediate({
          context,
          operation: ActorAbstractPath.FACTORY.createFilter(
            ActorAbstractPath.FACTORY
              .createPattern(operation.subject, varP, operation.object, operation.graph),
            ActorAbstractPath.FACTORY.createOperatorExpression('=', [
              ActorAbstractPath.FACTORY.createTermExpression(operation.subject),
              ActorAbstractPath.FACTORY.createTermExpression(operation.object),
            ]),
          ),
        }),
      ).bindingsStream.transform({
        map(bindings) {
          return bindings.delete(varP);
        },
        autoStart: false,
      });
      bindingsStream = new UnionIterator([
        bindingsZero,
        bindingsOne.bindingsStream,
      ], { autoStart: false });
    } else {
      // If subject or object is not a variable, then determining the "Zero" part is simple.
      if (operation.subject.termType === 'Variable') {
        extra.push(BF.bindings([[ operation.subject, operation.object ]]));
      }
      if (operation.object.termType === 'Variable') {
        extra.push(BF.bindings([[ operation.object, operation.subject ]]));
      }

      bindingsStream = bindingsOne.bindingsStream.prepend(extra);
    }

    return {
      type: 'bindings',
      bindingsStream,
      metadata: bindingsOne.metadata,
    };
  }
}
