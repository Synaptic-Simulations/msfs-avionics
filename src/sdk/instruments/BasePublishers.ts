import { EventBus, EventBusMetaEvents, MockEventTypes, Publisher } from '../data/EventBus';
import { PublishPacer } from '../data/EventBusPacer';
import { SimVarDefinition, SimVarValueType } from '../data/SimVars';
import { Subject } from '../sub'

/**
 * A basic event-bus publisher.
 */
export class BasePublisher<E> {

    private bus: EventBus;
    private publisher: Publisher<E>;
    private publishActive: boolean;
    private pacer: PublishPacer<E> | undefined;

    /**
     * Creates an instance of BasePublisher.
     * @param bus The common event bus.
     * @param pacer An optional pacer to control the rate of publishing.
     */
    public constructor(bus: EventBus, pacer: PublishPacer<E> | undefined = undefined) {
        this.bus = bus;
        this.publisher = this.bus.getPublisher<E>();
        this.publishActive = false;
        this.pacer = pacer;
    }

    /**
     * Start publishing.
     */
    public startPublish(): void {
        this.publishActive = true;
    }

    /**
     * Stop publishing.
     */
    public stopPublish(): void {
        this.publishActive = false;
    }

    /**
     * Tells whether or not the publisher is currently active.
     * @returns True if the publisher is active, false otherwise.
     */
    public isPublishing(): boolean {
        return this.publishActive;
    }

    /**
     * A callback called when the publisher receives an update cycle.
     */
    public onUpdate(): void {
        return;
    }

    /**
     * Publish a message if publishing is acpive
     * @param topic The topic key to publish to.
     * @param data The data type for chosen topic.
     * @param sync Whether or not the event should be synced to other instruments. Defaults to `false`.
     * @param isCached Whether or not the event should be cached. Defaults to `true`.
     */
    protected publish<K extends keyof E>(topic: K, data: E[K], sync = false, isCached = true): void {
        if (this.publishActive && (!this.pacer || this.pacer.canPublish(topic, data))) {
            this.publisher.pub(topic, data, sync, isCached);
        }
    }
}

/**
 * A publisher that sends a constant stream of random numbers.
 */
export class RandomNumberPublisher extends BasePublisher<MockEventTypes> {
    /**
     * Start publishing random numbers.
     */
    public startPublish(): void {
        super.startPublish();
        this.publishRandomNumbers();
    }

    /**
     * Async thread that publishes random numbers
     * @param ms - Milliseconds to sleep between publishes
     */
    private async publishRandomNumbers(ms = 1000): Promise<any> {
        while (this.isPublishing()) {
            const newVal = Math.floor(Math.random() * ms);
            this.publish('randomNumber', newVal, true);
            await new Promise(r => setTimeout(r, ms));
        }
    }
}

/**
 * An entry for a sim var publisher topic.
 */
export type SimVarPublisherEntry<T> = SimVarDefinition & {
    /**
     * A function which maps the raw simvar value to the value to be published to the event bus. If not defined, the
     * raw simvar value will be published to the bus as-is.
     */
    map?: (value: any) => T;
};

/**
 * A base class for publishers that need to handle simvars with built-in
 * support for pacing callbacks.
 */
export class SimVarPublisher<E> extends BasePublisher<E> {
    protected readonly simvars: Map<keyof E, SimVarPublisherEntry<any>>;
    protected readonly subscribed: Set<keyof E>;

    /**
     * Create a SimVarPublisher
     * @param simVarMap A map of simvar event type keys to a SimVarDefinition.
     * @param bus The EventBus to use for publishing.
     * @param pacer An optional pacer to control the rate of publishing.
     */
    public constructor(
        simVarMap: Map<keyof E, SimVarDefinition>,
        bus: EventBus,
        pacer?: PublishPacer<E>
    ) {
        super(bus, pacer);

        this.simvars = simVarMap;
        this.subscribed = new Set();

        // Start polling all simvars for which there are existing subscriptions.
        for (const topic of this.simvars.keys()) {
            if (bus.getTopicSubscriberCount(topic.toString()) > 0) {
                this.onTopicSubscribed(topic);
            }
        }

        bus.getSubscriber<EventBusMetaEvents>().on('event_bus_topic_first_sub').handle(
            (topic: string) => {
                if (this.simvars.has(topic as any)) {
                    this.onTopicSubscribed(topic as keyof E);
                }
            });
    }

    /**
     * Responds to when one of this publisher's topics is subscribed to for the first time.
     * @param topic The topic that was subscribed to.
     */
    protected onTopicSubscribed(topic: keyof E): void {
        this.subscribed.add(topic);
    }

    /**
     * NOOP - For backwards compatibility.
     * @deprecated
     * @param data Key of the event type in the simVarMap
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public subscribe(data: keyof E): void {
        return;
    }

    /**
     * NOOP - For backwards compatibility.
     * @deprecated
     * @param data Key of the event type in the simVarMap
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public unsubscribe(data: keyof E): void {
        return;
    }

    /**
     * Publish all subscribed data points to the bus.
     */
    public onUpdate(): void {
        for (const topic of this.subscribed.values()) {
            this.publishTopic(topic);
        }
    }

    /**
     * Publishes data to the event bus for a topic.
     * @param topic The topic to publish.
     */
    protected publishTopic(topic: keyof E): void {
        const value = this.getValue(topic);
        if (value !== undefined) {
            this.publish(topic, value);
        }
    }

    /**
     * Gets the current value for a topic.
     * @param topic A topic.
     * @returns The current value for the specified topic.
     */
    protected getValue<K extends keyof E>(topic: K): E[K] | undefined {
        const entry = this.simvars.get(topic);
        if (entry === undefined) {
            return undefined;
        }

        return entry.map === undefined
            ? this.getSimVarValue(entry)
            : entry.map(this.getSimVarValue(entry));
    }

    /**
     * Gets the value of the SimVar
     * @param entry The SimVar definition entry
     * @returns The value of the SimVar
     */
    private getSimVarValue(entry: SimVarPublisherEntry<any>): any {
        const svValue = SimVar.GetSimVarValue(entry.name, entry.type);
        if (entry.type === SimVarValueType.Bool) {
            return svValue === 1;
        }
        return svValue;
    }

    /**
     * Change the simvar read for a given key.
     * @param key The key of the simvar in simVarMap
     * @param value The new value to set the simvar to.
     */
    public updateSimVarSource(key: keyof E, value: SimVarDefinition): void {
        this.simvars.set(key, value);
    }
}

export interface SwitchableSimVarDefinition<TState> {
    name: (state: TState) => string;
    type: SimVarValueType;
}

/**
 * An extension of the SimVarPublisher that allows the SimVar context to be dependent on a subject.
 * https://github.com/flybywiresim/a32nx/blob/nd-v2/src/instruments/src/MsfsAvionicsCommon/providers/SwitchableProvider.ts
 */
export class SwitchableSimVarPublisher<TSimVar, TState> extends SimVarPublisher<TSimVar> {
    protected constructor(
        private simVars: Map<keyof TSimVar, SwitchableSimVarDefinition<TState>>,
        public stateSubject: Subject<TState>,
        bus: EventBus,
    ) {
        super(SwitchableSimVarPublisher.definitions(simVars, stateSubject.get()), bus);

        stateSubject.sub((value) => this.updateDefinitions(value));
    }

    private updateDefinitions(newStateValue: TState) {
        for (const [key, value] of this.simVars) {
            const newName = value.name(newStateValue);

            this.updateSimVarSource(key, { name: newName, type: value.type });
        }
    }

    private static definitions<TSimVar, TState>(
        simVars: Map<keyof TSimVar, SwitchableSimVarDefinition<TState>>,
        state: TState,
    ): Map<keyof TSimVar, SimVarDefinition> {
        return new Map(Array.from(simVars.entries()).map(([k, v]) => [k, {
            name: v.name(state),
            type: v.type,
        }]));
    }
}
