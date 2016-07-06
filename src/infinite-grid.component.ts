import { 
    Component, 
    ChangeDetectionStrategy, 
    ElementRef, 
    ViewContainerRef, 
    TemplateRef,
    ContentChild,
    Input, 
    OnInit, 
    OnDestroy
} from '@angular/core';

import { IIterator } from './iterator.interface';
import { ViewPort } from './view-port.model';

const viewPortSizeMultiplier = 1.5;
const viewPortMoveBoundaryMultiplier = 0.4;
const scrollContainerAttributeName = 'cool-infinite-grid-container';
const millisecondsToWaitOnScrollingBeforeRendering = 50;

@Component({
    selector: 'cool-infinite-grid',
    template: `
        <div class="cool-infinite-grid">
        </div>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [`
        :host-context([${scrollContainerAttributeName}]) {
            overflow-y: auto;
            overflow-x: hidden;
        }

        :host {
            display: block;
            position: relative;
        }
    `]
})
export class CoolInfiniteGridComponent implements OnInit, OnDestroy {
    private scrollContainer;
    
    private currentElementHeight: number = 0;

    private itemsPerRow: number;
    private rowsPerViewPort: number;
    private itemsPerViewPort: number;
    private viewPortHeight: number;

    private topViewPort: ViewPort;
    private middleViewPort: ViewPort;
    private bottomViewPort: ViewPort;

    private moveTopBoundary: number;
    private moveBottomBoundary: number;

    private scrollHandler: EventListener;
    private resizeHandler: EventListener;

    @ContentChild(TemplateRef)
    private template: TemplateRef<Object>;

    constructor(private element: ElementRef, private viewContainer: ViewContainerRef) { }

    @Input()
    public itemIterator: IIterator<any>;

    @Input()
    public itemWidth: any;

    @Input()
    public itemHeight: any;

    @Input()
    public itemSpace: any;

    public async ngOnInit(): Promise<any> {
        const self = this;

        this.scrollContainer = getScrollContainer();

        this.calculateParameters();

        this.moveTopBoundary = 0;
        this.moveBottomBoundary = this.viewPortHeight * (1 - viewPortMoveBoundaryMultiplier);

        await this.initialRenderAsync();

        this.scrollHandler = () => {
            self.onContainerScroll();
        };

        this.resizeHandler = () => {
            self.onWindowResize();
        }

        window.addEventListener('scroll', this.scrollHandler);

        window.addEventListener('resize', this.resizeHandler);

        function getScrollContainer() {
            let currentNode = self.element.nativeElement.parentNode;

            while (currentNode) {
                if (currentNode.attributes && currentNode.attributes[scrollContainerAttributeName]) {
                    break;
                }

                currentNode = currentNode.parentNode;
            }

            if (currentNode) {
                return currentNode;
            }

            const parent = self.element.nativeElement.parentNode;

            parent.setAttribute(scrollContainerAttributeName, 'true');

            return parent;
        }
    }

    public ngOnDestroy() {
        window.removeEventListener('scroll', this.scrollHandler);
        window.removeEventListener('resize', this.resizeHandler);
    }
    
    private get visibleItemHeight() {
        return (this.itemHeight || 0) + (2 * (this.itemSpace || 0));
    }
    
    private get visibleItemWidth() {
        return (this.itemWidth || 0) + (2 * (this.itemSpace || 0));
    }

    private onWindowResize() {
        this.calculateParameters();

        this.reRenderAsync(this.scrollContainer.scrollTop);
    }

    private async getItems(fromIndex: number, numberOfItems: number): Promise<any[]> {
        const result = this.itemIterator.next(fromIndex, numberOfItems);

        if (!result) {
            return null;
        }

        if (typeof (result.value.then) === 'function') {
            return await result.value;
        }
        else if (result.value instanceof Array) {
            return result.value;
        }

        return null;
    }

    private calculateParameters() {
        const self = this;

        const availableWidth = calculateAvailableWidth();
        const availableHeight = calculateAvailableHeight();

        this.viewPortHeight = calculateViewPortHeight();
        this.rowsPerViewPort = calculateRowsPerViewPort();
        this.itemsPerRow = calculateItemsPerRow();
        this.itemsPerViewPort = this.rowsPerViewPort * this.itemsPerRow;

        function calculateAvailableWidth() {
            return self.scrollContainer.offsetWidth;
        }

        function calculateAvailableHeight() {
            return self.scrollContainer.offsetHeight;
        }

        function calculateViewPortHeight() {
            const bareHeight = availableHeight * viewPortSizeMultiplier;

            const rowsFitInHeight = Math.floor(bareHeight / self.visibleItemHeight);

            return rowsFitInHeight * self.visibleItemHeight;
        }

        function calculateRowsPerViewPort() {
            return self.viewPortHeight / self.visibleItemHeight;
        }

        function calculateItemsPerRow() {
            return Math.floor(availableWidth / self.visibleItemWidth);
        }
    }

    private onContainerScroll() {
        const currentScrollTop = this.scrollContainer.scrollTop;

        setTimeout(() => {
            const latestScrollTop = this.scrollContainer.scrollTop;

            if (currentScrollTop !== latestScrollTop) {
                return;
            }

            this.handleCurrentScroll(latestScrollTop);

        }, millisecondsToWaitOnScrollingBeforeRendering);
    }

    private async handleCurrentScroll(scrollTop: number): Promise<any> {
        if(scrollTop > this.bottomViewPort.bottomScrollTop && this.isLastViewPortRendered) {
            return;
        }        
        if(scrollTop < this.topViewPort.scrollTop || scrollTop > this.bottomViewPort.bottomScrollTop) {
            await this.reRenderAsync(scrollTop);
        }
        else if (scrollTop < this.moveTopBoundary) {
            await this.moveUpAsync(scrollTop);
        }
        else if (scrollTop > this.moveBottomBoundary) {
            await this.moveDownAsync(scrollTop);
        }
        else {
            return;
        }

        this.calculateMoveBoundaries();
    }

    private calculateMoveBoundaries() {
        this.moveTopBoundary = this.topViewPort.scrollTop + (this.viewPortHeight * (1 - viewPortMoveBoundaryMultiplier));

        if (this.moveTopBoundary < 0) {
            this.moveTopBoundary = 0;
        }

        if (this.isLastViewPortRendered) {
            this.moveBottomBoundary = Infinity;
        }
        else {
            this.moveBottomBoundary = this.middleViewPort.scrollTop + (this.viewPortHeight * (1 - viewPortMoveBoundaryMultiplier));
        }
    }

    private get isLastViewPortRendered() {
        return this.topViewPort.isLastViewPort || this.middleViewPort.isLastViewPort || this.bottomViewPort.isLastViewPort;
    }

    private plannedViewPortScrollTop: number;

    private async moveUpAsync(scrollTop: number): Promise<void> {
        const viewPortScrollTop = this.topViewPort.scrollTop - this.viewPortHeight;
        const fromIndex = this.topViewPort.itemsFromIndex - this.itemsPerViewPort;

        this.plannedViewPortScrollTop = viewPortScrollTop;

        const viewPortItems = await this.getItems(fromIndex, this.itemsPerViewPort);

        if (this.plannedViewPortScrollTop !== viewPortScrollTop) {
            return;
        }

        if(!viewPortItems || !viewPortItems.length) {
            return;
        }

        const newViewPort = new ViewPort();
        newViewPort.scrollTop = viewPortScrollTop;
        newViewPort.items = viewPortItems;
        newViewPort.itemsFromIndex = fromIndex;
        newViewPort.isLastViewPort = false;
        newViewPort.height = this.calculateViewPortHeight(newViewPort.numberOfItems);
        
        this.renderViewPort(newViewPort);        

        const oldBottomViewPort = this.bottomViewPort;

        this.bottomViewPort = this.middleViewPort;
        this.middleViewPort = this.topViewPort;
        this.topViewPort = newViewPort;

        this.destroyViewPort(oldBottomViewPort);
    }

    private async moveDownAsync(scrollTop: number): Promise<void> {
        const viewPortScrollTop = this.bottomViewPort.bottomScrollTop;
        const fromIndex = this.bottomViewPort.itemsFromIndex + this.itemsPerViewPort;
        
        this.plannedViewPortScrollTop = viewPortScrollTop;

        const viewPortItems = await this.getItems(fromIndex, this.itemsPerViewPort);

        if (this.plannedViewPortScrollTop !== viewPortScrollTop) {
            return;
        }

        if(!viewPortItems || !viewPortItems.length) {
            this.bottomViewPort.isLastViewPort = true;

            return;
        }

        const newViewPort = new ViewPort();
        newViewPort.scrollTop = viewPortScrollTop;
        newViewPort.items = viewPortItems;
        newViewPort.itemsFromIndex = fromIndex;
        newViewPort.isLastViewPort = viewPortItems.length < this.itemsPerViewPort;
        newViewPort.height = this.calculateViewPortHeight(newViewPort.numberOfItems);
        
        this.renderViewPort(newViewPort);

        const oldTopViewPort = this.topViewPort;

        this.topViewPort = this.middleViewPort;
        this.middleViewPort = this.bottomViewPort;
        this.bottomViewPort = newViewPort;

        this.destroyViewPort(oldTopViewPort);
    }   

    private renderViewPort(viewPort: ViewPort) {
        const viewPortElement = document.createElement('div');

        viewPortElement.classList.add('cool-infinite-grid-view-port');
        viewPortElement.style.top = `${viewPort.scrollTop}px`;
        viewPortElement.style.height = `${viewPort}px`;
        viewPortElement.style.position = 'absolute';

        viewPort.nativeElement = viewPortElement;

        const minimumElementHeight = viewPort.bottomScrollTop;
        if(minimumElementHeight > this.currentElementHeight) {
            this.currentElementHeight = minimumElementHeight;
            
            this.element.nativeElement.style.height = `${this.currentElementHeight}px`;
        }

        for(let item of viewPort.items) {
            let embeddedView = this.template.createEmbeddedView({
                $implicit: item
            });

            viewPort.renderedItems.push(embeddedView);

            this.viewContainer.insert(embeddedView);

            let itemNode = document.createElement('div');
            itemNode.classList.add('cool-infinite-grid-item');
            itemNode.style.display = 'inline-block';
            itemNode.style.verticalAlign = 'top';
            itemNode.style.height = `${this.itemHeight}px`;
            itemNode.style.width = `${this.itemWidth}px`;
            itemNode.style.margin = `${this.itemSpace}px`;

            for(let viewNode of embeddedView.rootNodes) {
                itemNode.appendChild(viewNode);
            }

            viewPort.nativeElement.appendChild(itemNode);
        }

        this.element.nativeElement.appendChild(viewPort.nativeElement);
    }

    private destroyViewPort(viewPort: ViewPort) {
        for(let item of viewPort.renderedItems) {
            item.destroy();
        }

        this.element.nativeElement.removeChild(viewPort.nativeElement);
    }

    private async initialRenderAsync(): Promise<any> {
        await this.reRenderAsync(0);

        this.calculateMoveBoundaries();
    }

    private async reRenderAsync(scrollTop: number): Promise<any> {
        const currentViewPortIndex = Math.floor(scrollTop / this.viewPortHeight);
        const topScrollTop = currentViewPortIndex * this.viewPortHeight;

        const fromIndex = currentViewPortIndex * this.itemsPerViewPort;

        const viewPortItems = await this.getItems(fromIndex, 3 * this.itemsPerViewPort);

        if(this.topViewPort) {
            this.destroyViewPort(this.topViewPort);
        }

        this.topViewPort = new ViewPort();

        this.topViewPort.scrollTop = topScrollTop;
        this.topViewPort.itemsFromIndex = fromIndex;
        this.topViewPort.items = viewPortItems.slice(0, this.itemsPerViewPort);
        this.topViewPort.isLastViewPort = this.topViewPort.numberOfItems < this.itemsPerViewPort;
        this.topViewPort.height = this.calculateViewPortHeight(this.topViewPort.numberOfItems);        

        this.renderViewPort(this.topViewPort);

        if(this.middleViewPort) {
            this.destroyViewPort(this.middleViewPort);
        }

        this.middleViewPort = new ViewPort();

        this.middleViewPort.scrollTop = topScrollTop + this.viewPortHeight;
        this.middleViewPort.itemsFromIndex = fromIndex + this.itemsPerViewPort;
        this.middleViewPort.items = viewPortItems.slice(this.itemsPerViewPort, 2 * this.itemsPerViewPort);
        this.middleViewPort.isLastViewPort = this.middleViewPort.numberOfItems < this.itemsPerViewPort;
        this.middleViewPort.height = this.calculateViewPortHeight(this.middleViewPort.numberOfItems);

        this.renderViewPort(this.middleViewPort);

        if(this.bottomViewPort) {
            this.destroyViewPort(this.bottomViewPort);
        }   

        this.bottomViewPort = new ViewPort();

        this.bottomViewPort.scrollTop = topScrollTop + (2 * this.viewPortHeight);
        this.bottomViewPort.itemsFromIndex = fromIndex + (2 * this.itemsPerViewPort);
        this.bottomViewPort.items = viewPortItems.slice(2 * this.itemsPerViewPort, 3 * this.itemsPerViewPort);
        this.bottomViewPort.isLastViewPort = this.bottomViewPort.numberOfItems < this.itemsPerViewPort;
        this.bottomViewPort.height = this.calculateViewPortHeight(this.bottomViewPort.numberOfItems);

        this.renderViewPort(this.bottomViewPort);          
    } 

    private calculateViewPortHeight(numberOfItems: number): number {
        if(numberOfItems === this.itemsPerViewPort) {
            return this.viewPortHeight;
        }

        let rowCount = Math.ceil(numberOfItems / this.itemsPerRow);

        return rowCount * this.visibleItemHeight;
    }
}