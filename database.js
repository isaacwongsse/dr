// Database Service for Daily Report Generator
// Using IndexedDB for persistent storage

class DatabaseService {
    constructor() {
        this.db = null;
        this.isInitialized = false;
        this.initPromise = null;
    }

    // Initialize database connection
    async init() {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async () => {
            try {
                console.log('Initializing IndexedDB database...');
                await this.initIndexedDB();
                this.isInitialized = true;
                console.log('Database initialized successfully');
                return this;
            } catch (error) {
                console.error('Database initialization failed:', error);
                throw error;
            }
        })();

        return this.initPromise;
    }

    // Initialize IndexedDB
    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('dailyRecordDB', 2);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;
                
                // Version 1: Initial schema
                if (oldVersion < 1) {
                    // Create projects store
                    const projectsStore = db.createObjectStore('projects', { 
                        keyPath: 'id',
                        autoIncrement: true 
                    });
                    projectsStore.createIndex('name', 'name', { unique: true });
                    
                    // Create location_plans store  
                    const locationPlansStore = db.createObjectStore('location_plans', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    locationPlansStore.createIndex('project_id', 'project_id');
                    
                    // Create plan_labels store
                    const planLabelsStore = db.createObjectStore('plan_labels', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    planLabelsStore.createIndex('location_plan_id', 'location_plan_id');
                }
                
                // Version 2: Add timestamp fields
                if (oldVersion < 2) {
                    const transaction = event.target.transaction;
                    
                    // Add timestamps to projects
                    const projectsStore = transaction.objectStore('projects');
                    const projectsRequest = projectsStore.openCursor();
                    
                    projectsRequest.onsuccess = function() {
                        const cursor = projectsRequest.result;
                        if (cursor) {
                            const project = cursor.value;
                            if (!project.created_at) {
                                project.created_at = new Date().toISOString();
                                project.updated_at = new Date().toISOString();
                                cursor.update(project);
                            }
                            cursor.continue();
                        }
                    };
                }
            };
        });
    }

    // Project management
    async getProjects() {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readonly');
            const store = transaction.objectStore('projects');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getProject(id) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readonly');
            const store = transaction.objectStore('projects');
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveProject(project) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readwrite');
            const store = transaction.objectStore('projects');
            
            // Add timestamps
            const now = new Date().toISOString();
            if (!project.id) {
                // New project
                project.created_at = now;
                project.updated_at = now;
                const request = store.add(project);
                
                request.onsuccess = () => {
                    project.id = request.result;
                    resolve(project);
                };
                request.onerror = () => reject(request.error);
            } else {
                // Update existing project
                project.updated_at = now;
                const request = store.put(project);
                
                request.onsuccess = () => resolve(project);
                request.onerror = () => reject(request.error);
            }
        });
    }

    async deleteProject(id) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readwrite');
            const store = transaction.objectStore('projects');
            const request = store.delete(id);
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /** Clear only the projects store (for import: replace all templates). */
    async clearProjects() {
        await this.ensureInitialized();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readwrite');
            const store = transaction.objectStore('projects');
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Location plan management
    async saveLocationPlan(projectId, pdfData, scale = 1, rotation = 0, offsetX = 0, offsetY = 0) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['location_plans'], 'readwrite');
            const store = transaction.objectStore('location_plans');
            
            const locationPlan = {
                project_id: projectId,
                pdf_data: pdfData,
                scale,
                rotation,
                offset_x: offsetX,
                offset_y: offsetY,
                created_at: new Date().toISOString()
            };
            
            const request = store.add(locationPlan);
            
            request.onsuccess = () => {
                locationPlan.id = request.result;
                resolve(locationPlan);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getLocationPlan(projectId) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['location_plans'], 'readonly');
            const store = transaction.objectStore('location_plans');
            const index = store.index('project_id');
            const request = index.get(projectId);
            
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    // Label management
    async saveLabel(locationPlanId, x, y, text, color = '#FF0000') {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['plan_labels'], 'readwrite');
            const store = transaction.objectStore('plan_labels');
            
            const label = {
                location_plan_id: locationPlanId,
                x,
                y,
                text,
                color,
                created_at: new Date().toISOString()
            };
            
            const request = store.add(label);
            
            request.onsuccess = () => {
                label.id = request.result;
                resolve(label);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getLabels(locationPlanId) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['plan_labels'], 'readonly');
            const store = transaction.objectStore('plan_labels');
            const index = store.index('location_plan_id');
            const request = index.getAll(locationPlanId);
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteLabel(labelId) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['plan_labels'], 'readwrite');
            const store = transaction.objectStore('plan_labels');
            const request = store.delete(labelId);
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Helper method to ensure database is initialized
    async ensureInitialized() {
        if (!this.isInitialized) {
            await this.init();
        }
    }

    // Export/Import functionality
    async exportDatabase() {
        await this.ensureInitialized();
        
        const data = {
            projects: await this.getProjects(),
            location_plans: await this.getAllLocationPlans(),
            plan_labels: await this.getAllLabels()
        };
        
        return new Blob([JSON.stringify(data)], { type: 'application/json' });
    }

    async importDatabase(blob) {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    
                    // Clear existing data
                    await this.clearDatabase();
                    
                    // Import projects
                    for (const project of data.projects || []) {
                        await this.saveProject(project);
                    }
                    
                    // Import location plans
                    for (const locationPlan of data.location_plans || []) {
                        const transaction = this.db.transaction(['location_plans'], 'readwrite');
                        const store = transaction.objectStore('location_plans');
                        await new Promise((resolve, reject) => {
                            const request = store.add(locationPlan);
                            request.onsuccess = () => resolve();
                            request.onerror = () => reject(request.error);
                        });
                    }
                    
                    // Import labels
                    for (const label of data.plan_labels || []) {
                        const transaction = this.db.transaction(['plan_labels'], 'readwrite');
                        const store = transaction.objectStore('plan_labels');
                        await new Promise((resolve, reject) => {
                            const request = store.add(label);
                            request.onsuccess = () => resolve();
                            request.onerror = () => reject(request.error);
                        });
                    }
                    
                    resolve(true);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blob);
        });
    }

    // Internal helper methods
    async getAllLocationPlans() {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['location_plans'], 'readonly');
            const store = transaction.objectStore('location_plans');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllLabels() {
        await this.ensureInitialized();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['plan_labels'], 'readonly');
            const store = transaction.objectStore('plan_labels');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async clearDatabase() {
        await this.ensureInitialized();
        
        const stores = ['projects', 'location_plans', 'plan_labels'];
        
        for (const storeName of stores) {
            await new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }
    }
}

// Singleton instance
const databaseService = new DatabaseService();

export default databaseService;
